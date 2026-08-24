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

/**
 * #104: a fence that is the *only* content of its container used to go the
 * same way, and take the container with it. The mechanism is the one above,
 * one level up — a container holding nothing but a blank child is blank
 * itself, so the blank rule replaced the whole of it before the `<pre>`
 * inside was ever consulted. Instrumented, the nodes reaching the hook are
 * `CODE, PRE, BLOCKQUOTE` for a blockquote and `CODE, PRE, LI, UL` for a
 * list.
 *
 * **This block is the inverted gap.** It was written on #103 as a labelled
 * gap asserting the loss — the way #89 left one for #103 — so that whoever
 * fixed it would meet a decision rather than a surprise. Its two cases are
 * the first two rows below, now asserting what they keep instead of what they
 * lost.
 *
 * **Not a regression it repairs, but a loss that predates both**: all of
 * these lose the fence on `cdac091` and on `8141cc9` alike.
 *
 * The nesting rows are the measurement #104 asked for whichever way it fell.
 * It falls this way: each level is one delegation over a `content` that is
 * already finished, so depth costs nothing and the shapes hold at two levels
 * as they do at one.
 */
describe('a fence alone in its container survives with it (#104)', () => {
  it.each([
    ['a blockquote', '> ```\n> ```'],
    ['a list item', '- ```\n  ```'],
    ['a blockquote, with a language', '> ```js\n> ```'],
    ['a list item, with a language', '- ```js\n  ```'],
    ['an ordered item', '1. ```\n   ```'],
    ['an ordered item past 1', '7. ```\n   ```'],
    ['a list item inside a blockquote', '> - ```\n>   ```'],
    ['a blockquote inside a list item', '- > ```\n  > ```'],
    ['a list item inside a list item', '- - ```\n    ```'],
    ['a list item inside a blockquote, with a language', '> - ```js\n>   ```'],
  ])('writes an empty fence alone in %s back byte for byte', (_label, markdown) => {
    expect(roundtrip(markdown)).toBe(markdown);
  });

  it('is stable on the second save', () => {
    // The property #96 established, asked of the container shapes too.
    for (const markdown of ['> ```\n> ```', '- ```\n  ```', '> - ```\n>   ```']) {
      const once = roundtrip(markdown);
      expect(roundtrip(once)).toBe(once);
    }
  });

  it('leaves a container holding a fence that has content alone', () => {
    for (const markdown of [
      '> ```\n> x\n> ```',
      '- ```\n  x\n  ```',
      '> ```js\n> const a = 1;\n> ```',
      '> - ```\n>   x\n>   ```',
    ]) {
      expect(roundtrip(markdown)).toBe(markdown);
    }
  });

  it.each([
    ['a blockquote', '> text\n>\n> ```\n> ```', '> text\n> \n> ```\n> ```'],
    ['a blockquote with a language', '> a\n>\n> ```js\n> ```', '> a\n> \n> ```js\n> ```'],
    ['a list item', '- text\n\n  ```\n  ```', '- text\n\n  ```\n  ```'],
  ])('still keeps an empty fence when %s holds something else too', (_label, markdown, expected) => {
    // The two shapes #103 could already reach, unchanged by this. The blank
    // quote line comes back as `> ` rather than `>`: turndown's blockquote
    // rule prefixes every line, blank ones included, and a blockquote holding
    // two paragraphs and no blank node at all shows the same.
    expect(roundtrip(markdown)).toBe(expected);
  });

  it('drops a container that really is empty, exactly as before', () => {
    // The condition the fix turns on is the *content*, not the fence, so this
    // is the half of it that must not move: a container whose children wrote
    // nothing is still blank, and turndown's own blank rule still has it.
    for (const [html, expected] of [
      ['<p>a</p><blockquote></blockquote><p>b</p>', 'a\n\nb'],
      ['<p>a</p><blockquote><p></p></blockquote><p>b</p>', 'a\n\nb'],
      ['<p>a</p><ul><li></li></ul><p>b</p>', 'a\n\nb'],
      ['<p>a</p><ol><li></li></ol><p>b</p>', 'a\n\nb'],
      ['<p>a</p><ul><li><p></p></li></ul><p>b</p>', 'a\n\nb'],
      ['<p>a</p><blockquote><ul><li></li></ul></blockquote><p>b</p>', 'a\n\nb'],
      ['<p>a</p><pre></pre><p>b</p>', 'a\n\nb'],
      ['<p>a</p><blockquote><pre></pre></blockquote><p>b</p>', 'a\n\nb'],
    ] as const) {
      expect(htmlToMarkdown(html).trim()).toBe(expected);
    }
  });

  it('is never consulted for a task item, because a checkbox is a void element', () => {
    // The `LI` entry in the container table has to make the same split the two
    // list rules make between them — rule *precedence* is what keeps those two
    // filters apart, and a blank node never reaches the rule array to be
    // ordered by it. That split is written for correctness, not for a shape
    // this pipeline can produce: turndown counts a node holding a **void**
    // element as non-blank, and every task item `marked` makes holds a
    // checkbox `<input>`. So a task item is never blank, its fence is reached
    // by the fence rule as any other is, and the hook is not consulted for the
    // item at all — which is why nothing here asserts how one is spelled.
    const markdown = '- [ ] todo\n\n  ```\n  ```';
    expect(markdownToHtml(markdown)).toContain('<input');
    expect(roundtrip(markdown)).toContain('```\n  ```');
  });

  it('writes what turndown itself writes for every container but the one holding a fence', () => {
    // The same "narrow" test the fence half makes, one level up: a document
    // through a service that has never heard of this fix differs in exactly
    // the two places the fence used to be dropped from.
    const html =
      '<p>a</p><blockquote><pre><code></code></pre></blockquote>' +
      '<blockquote><p></p></blockquote><ul><li></li></ul><p>b</p>';
    const untouched = new TurndownService({ codeBlockStyle: 'fenced', fence: '```' }).turndown(
      html,
    );
    expect(untouched).toBe('a\n\nb');
    expect(htmlToMarkdown(html)).toBe('a\n\n> ```\n> ```\n\nb');
  });
});
