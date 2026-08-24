import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './parse';
import { htmlToMarkdown } from './serialize';

/**
 * #94 at the pair level: a fenced block with nothing in it used to leave the
 * file on save — opening fence, closing fence and language with it.
 *
 * Measured on `cdac091`: every case in the first block below saved as `''`,
 * and `a`⏎⏎fence⏎⏎`b` saved as `a`⏎⏎`b`. The editor-level half of this — the
 * level the user meets, including the ``` input rule that makes exactly this
 * block — is in `src/editor/empty-fence.test.ts`.
 */
const roundtrip = (md: string): string => htmlToMarkdown(markdownToHtml(md)).trim();

describe('an empty fenced block survives the save (#94)', () => {
  it.each([
    ['a fence with nothing in it', '```\n```'],
    ['a fence with a language', '```js\n```'],
    ['a fence with a long language name', '```typescript\n```'],
    ['a fence between two paragraphs', 'a\n\n```\n```\n\nb'],
    ['a fence holding spaces', '```\n   \n```'],
    ['a fence holding a tab', '```\n\t\n```'],
    ['a fence with a language holding spaces', '```js\n  \n```'],
  ])('writes %s back byte for byte', (_label, markdown) => {
    expect(roundtrip(markdown)).toBe(markdown);
  });

  it('is stable on the second save', () => {
    // The property #96 established: whatever the first save writes, the
    // second must move nothing. It is the joint promise the fix and the
    // upstream exception below make together.
    for (const markdown of ['```\n```', '```js\n```', '```\n   \n```', '```\n\n```']) {
      const once = roundtrip(markdown);
      expect(roundtrip(once)).toBe(once);
    }
  });

  it('normalises a fence around a blank line, upstream and not here', () => {
    // ```⏎⏎``` and ```⏎``` are read by `marked` as the *same*
    // `<pre><code>\n</code></pre>`, so nothing downstream can tell them
    // apart. That is the recorded R-C2 exception "a blank line at the end of
    // a fenced block" meeting this fix: before it, the whole block was
    // dropped and the normalisation had nothing to show itself in.
    expect(markdownToHtml('```\n\n```')).toBe(markdownToHtml('```\n```'));
    expect(roundtrip('```\n\n```')).toBe('```\n```');
    expect(roundtrip('```js\n\n```')).toBe('```js\n```');
  });

  it('leaves a fence that has content alone', () => {
    for (const markdown of [
      '```\nx\n```',
      '```js\nconst a = 1;\n```',
      '```js\nconst a = 1;\n\nconst b = 2;\n```',
      '```\n\nx\n```',
    ]) {
      expect(roundtrip(markdown)).toBe(markdown);
    }
  });
});

/**
 * The override is narrow or it is a regression surface. `blankReplacement` is
 * consulted for **every** blank node, not only for a `<pre>`: instrumented
 * over the HTML below, the nodes that arrive are `CODE`, `PRE`, `P`, `EM`,
 * `LI`, `UL` — in that order, the child `<code>` before the `<pre>` that
 * holds it.
 *
 * Each assertion here is the value turndown's own blank rule produces, and
 * every one of them passes on `cdac091` as well: that is what makes them
 * evidence this change moved nothing but the fence.
 */
describe('every other blank node behaves as it did (#94)', () => {
  it.each([
    ['an empty paragraph between two others', '<p>a</p><p></p><p>b</p>', 'a\n\nb'],
    ['an empty inline element', '<p>c <em></em> d</p>', 'c d'],
    ['an empty strong', '<p>c <strong></strong> d</p>', 'c d'],
    ['an empty list item', '<ul><li></li><li>x</li></ul>', '- x'],
    ['an empty list', '<p>a</p><ul><li></li></ul><p>b</p>', 'a\n\nb'],
    ['an empty blockquote', '<p>a</p><blockquote></blockquote><p>b</p>', 'a\n\nb'],
    ['an empty heading', '<p>a</p><h2></h2><p>b</p>', 'a\n\nb'],
    ['a pre with no code child', '<p>a</p><pre></pre><p>b</p>', 'a\n\nb'],
  ])('leaves %s exactly as it was', (_label, html, expected) => {
    expect(htmlToMarkdown(html).trim()).toBe(expected);
  });

  it('writes what turndown itself writes for every blank node but the fence', () => {
    // The strongest form of "narrow": the same document through a service
    // that has never heard of this fix differs in one place only — the block
    // that used to be dropped.
    const html = '<p>a</p><pre><code></code></pre><p>b</p><p></p><p>c <em></em> d</p>';
    const untouched = new TurndownService({ codeBlockStyle: 'fenced', fence: '```' }).turndown(
      html,
    );
    expect(untouched).toBe('a\n\nb\n\nc d');
    expect(htmlToMarkdown(html)).toBe('a\n\n```\n```\n\nb\n\nc d');
  });
});
