import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { createNarrowedEscape } from './escape';
import { htmlToMarkdown } from './serialize';

/**
 * #90 at the level of the function itself.
 *
 * `roundtrip.test.ts` and `src/editor/escape-noise.test.ts` cover the two
 * levels a user meets. This file covers the two things neither of them can
 * reach: what the narrowing does *relative to* turndown's own escape, and the
 * cases that only exist as an HTML text node, because expressing them as
 * markdown input turns them into something else before `escape` is called.
 */
const escapeAll = TurndownService.prototype.escape.bind(new TurndownService());
const narrowed = createNarrowedEscape(escapeAll);

describe('the narrowing withholds exactly two cases', () => {
  it.each([
    ['an intraword underscore', 'cl100k_base'],
    ['a double underscore inside a word', 'foo__bar'],
    ['several in one word', 'a_b_c'],
    ['a lone backtick', 'one ` backtick'],
    ['a bare triple run', 'a ``` run'],
    ['runs of different lengths', 'a ` and ``` here'],
  ])('leaves %s alone where turndown escaped it', (_label, text) => {
    expect(escapeAll(text)).not.toBe(text);
    expect(narrowed(text)).toBe(text);
  });

  it.each([
    ['an underscore that could open emphasis', '_foo'],
    ['an underscore that could close emphasis', 'foo_'],
    ['an underscore between punctuation', 'a (_) b'],
    ['an underscore at the edge of the text node', '_'],
    ['an asterisk, which CommonMark reads intraword', 'foo*bar*baz'],
    ['a closable backtick run', 'a ` b ` c'],
    ['two closable runs of length two', 'a `` b `` c'],
    ['brackets', 'a [not a link] here'],
    ['a heading marker at the start', '# not a heading'],
  ])('escapes %s exactly as turndown did', (_label, text) => {
    expect(narrowed(text)).toBe(escapeAll(text));
  });

  it('escapes a run that a later run of the same length can close', () => {
    // The boundary this rule cannot see is the *element* boundary: `escape`
    // is handed one text node at a time, so a partner in the next node is
    // invisible. When the vantage point cannot tell, it escapes — that costs
    // bytes, the other direction would cost meaning.
    expect(htmlToMarkdown('<p>a ` b ` c</p>')).toBe('a \\` b \\` c');
    expect(htmlToMarkdown('<p>a ` b</p>')).toBe('a ` b');
  });

  it('leaves a text node holding a sentinel to turndown untouched', () => {
    // Private Use Area code points stand in for the withheld characters. A
    // document containing one would have it rewritten on the way back, so the
    // narrowing steps aside entirely rather than corrupting a character in the
    // user's file.
    const withSentinel = 'a  b_c';
    expect(narrowed(withSentinel)).toBe(escapeAll(withSentinel));
  });
});
