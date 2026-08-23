import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { createNarrowedEscape } from './escape';
import { htmlToMarkdown } from './serialize';

/**
 * #90 at the level of the function itself.
 *
 * `roundtrip.test.ts` and `src/editor/escape-noise.test.ts` cover the two
 * levels a user meets. This file covers what neither of them can reach: what
 * the narrowing does *relative to* turndown's own escape — which is the only
 * place the boundary of the change is visible as a boundary.
 */
const escapeAll = TurndownService.prototype.escape.bind(new TurndownService());
const narrowed = createNarrowedEscape(escapeAll);

describe('the narrowing withholds exactly one case', () => {
  it.each([
    ['an intraword underscore', 'cl100k_base'],
    ['a double underscore inside a word', 'foo__bar'],
    ['several in one word', 'a_b_c'],
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
    ['brackets', 'a [not a link] here'],
    ['a heading marker at the start', '# not a heading'],
  ])('escapes %s exactly as turndown did', (_label, text) => {
    expect(narrowed(text)).toBe(escapeAll(text));
  });

  it('escapes every backtick, exactly as turndown always did', () => {
    // Not an oversight — a recorded R-C2 exception. Whether a run opens a code
    // span depends on a partner of equal length somewhere in the same *block*,
    // and `escape` is handed one text node at a time. A narrowing tried in the
    // first draft of #96 withheld both runs of `` a ` b <strong>x</strong> c ` d ``
    // because each looked unpaired from inside its own node; re-reading the
    // result paired them and swallowed the `<strong>` into a code span. Bytes
    // are the safe direction here, meaning is not.
    expect(htmlToMarkdown('<p>a ` b ` c</p>')).toBe('a \\` b \\` c');
    expect(htmlToMarkdown('<p>a ` b</p>')).toBe('a \\` b');
    expect(htmlToMarkdown('<p>a ``` b</p>')).toBe('a \\`\\`\\` b');
  });

  it('keeps an underscore decidable from one text node, across a boundary', () => {
    // The property that makes the surviving half safe where the removed half
    // was not. Intraword-ness is *local* — settled by the two characters beside
    // the run — so a node boundary makes a run non-intraword, which is the
    // escaping direction. Nothing here depends on what lies in the next node.
    expect(htmlToMarkdown('<p>foo_bar <strong>x</strong> baz_qux</p>')).toBe(
      'foo_bar **x** baz_qux',
    );
    expect(htmlToMarkdown('<p>tail_</p>')).toBe('tail\\_');
    expect(htmlToMarkdown('<p>_head</p>')).toBe('\\_head');
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
