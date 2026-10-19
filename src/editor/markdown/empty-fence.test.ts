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
    // second must move nothing.
    for (const markdown of ['```\n```', '```js\n```', '```\n   \n```', '```\n\n```']) {
      const once = roundtrip(markdown);
      expect(roundtrip(once)).toBe(once);
    }
  });

  it('keeps a fence around a blank line, told apart by a stamp (#625)', () => {
    // ```⏎⏎``` and ```⏎``` are read by `marked` as the *same*
    // `<pre><code>\n</code></pre>`; the parse stamps the first from the raw
    // of its token, and the blank rule writes its line back.
    expect(markdownToHtml('```\n\n```')).toBe(
      markdownToHtml('```\n```').replace('<pre>', '<pre data-fence-blank-line="">'),
    );
    expect(roundtrip('```\n\n```')).toBe('```\n\n```');
    expect(roundtrip('```js\n\n```')).toBe('```js\n\n```');
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
 *
 * **Four rows left this table with #564**: an empty list item, an empty
 * list, an empty blockquote and an empty heading were dropped here as
 * turndown drops them, and are now written as their markers. They are pinned
 * in `empty-block.test.ts`.
 */
describe('every other blank node behaves as it did (#94)', () => {
  it.each([
    ['an empty paragraph between two others', '<p>a</p><p></p><p>b</p>', 'a\n\nb'],
    ['an empty inline element', '<p>c <em></em> d</p>', 'c d'],
    ['an empty strong', '<p>c <strong></strong> d</p>', 'c d'],
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
    ['an ordered item starting at three', '3. ```\n   ```'],
    ['an ordered item starting at five, with a language', '5. ```js\n   ```'],
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
    ['a blockquote', '> text\n>\n> ```\n> ```'],
    ['a blockquote with a language', '> a\n>\n> ```js\n> ```'],
    ['a list item', '- text\n\n  ```\n  ```'],
  ])('still keeps an empty fence when %s holds something else too', (_label, markdown) => {
    // The two shapes #103 could already reach, unchanged by this.
    //
    // **The first two rows used to carry a separate expected value** because
    // the blank quote line came back as a marker and a space where the file
    // had a bare marker — turndown prefixes every line of a quote, blank ones
    // included. That was a recorded R-C2 exception and it is gone (#199), so
    // all three rows are byte-identical now and the column that held the
    // difference went with the exception.
    expect(roundtrip(markdown)).toBe(markdown);
  });

  it('writes a container that really is empty as its marker (#564)', () => {
    // The condition the fix turns on is the *content*, not the fence, so a
    // container whose children wrote nothing does not reach the container
    // table. Until #564 turndown's own blank rule had it and it was dropped;
    // it is now written as its marker by `empty-block.ts`, and a `pre` with
    // no `code`, which is no construct of the file, is dropped as before.
    for (const [html, expected] of [
      ['<p>a</p><blockquote></blockquote><p>b</p>', 'a\n\n> \n\nb'],
      ['<p>a</p><blockquote><p></p></blockquote><p>b</p>', 'a\n\n> \n\nb'],
      ['<p>a</p><ul><li></li></ul><p>b</p>', 'a\n\n-\n\nb'],
      ['<p>a</p><ol><li></li></ol><p>b</p>', 'a\n\n1.\n\nb'],
      ['<p>a</p><ul><li><p></p></li></ul><p>b</p>', 'a\n\n-\n\nb'],
      ['<p>a</p><blockquote><ul><li></li></ul></blockquote><p>b</p>', 'a\n\n> -\n\nb'],
      ['<p>a</p><pre></pre><p>b</p>', 'a\n\nb'],
      ['<p>a</p><blockquote><pre></pre></blockquote><p>b</p>', 'a\n\n> \n\nb'],
    ] as const) {
      expect(htmlToMarkdown(html).trim()).toBe(expected);
    }
  });

  it('writes a blank list item by the rule that item would have used', () => {
    // The two shapes side by side, because they are one line apart in the DOM
    // and a whole rule apart in the output. Which one is written is decided by
    // `data-type="taskList"` on the **parent**, which is what the two `LI`
    // filters read — so the pair is pinned here rather than described
    // somewhere, where the attribute can quietly go missing from the telling.
    //
    // **The task item's closing fence used to sit at the margin** — this row
    // read `'- [ ] ```\n```'` until #157 — and a fence at the margin is not in
    // the item any more: measured, that spelling comes back as an item holding
    // an unterminated fence *and* a second, empty one below the list. The two
    // rules are still a rule apart, and now they indent their continuation
    // lines the same way, which is the only spelling either container can be
    // read back from.
    expect(htmlToMarkdown('<ul><li><pre><code></code></pre></li></ul>')).toBe('- ```\n  ```');
    expect(htmlToMarkdown('<ul data-type="taskList"><li><pre><code></code></pre></li></ul>')).toBe(
      '- [ ] ```\n  ```',
    );
  });

  it('is reached, for a task item, by an empty fence and by nothing else (#104, amended by #160)', () => {
    // ── The premise this row used to pin, and why it was right ──
    //
    // It read *is never consulted for a task item, because a checkbox is a
    // void element*, and that was true when it was written. turndown counts a
    // node holding a **void** element as non-blank, `INPUT` is on its void
    // list, and every task item `marked` produced held a checkbox `<input>` —
    // so the `LI` entry in the container table was written for correctness and
    // could not be reached by a task item at all.
    //
    // **#160 made the premise false, deliberately.** The checkbox rewrite in
    // `parse.ts` now matches the loose spelling too — `<li><p><input>`, which
    // is what a list with blank lines between its items produces — and removes
    // that input. From then on a task item can be blank. Before it, a loose
    // task list lost every marker it had.
    //
    // ── What reaches the branch, stated as a rule and not as a list ──
    //
    // A task item whose content, under turndown's own `isBlank`, is an **empty
    // fenced block** — with or without a language — wrapped in **zero or more
    // containers that are themselves blank**, drawn from the container table's
    // own keys. Nothing else reaches it: the fence is the only blank node this
    // repository writes anything for, so every other blank item arrives with
    // an empty `content` and turndown's own blank rule keeps it, exactly as
    // before. Five shapes were measured on #160 and all five are that one
    // sentence; the rows here are its evidence, not its statement.
    //
    // ── That it is correct there, and why it is not luck ──
    //
    // **#157 rewrote `taskListItemReplacement` to work from the node rather
    // than from `content`.** On the blank path `content` is empty while the
    // node still holds the blocks, so the marker and the fence are both
    // written. Before #157 the branch would have written an empty marker.
    // Whoever moves that replacement back to reading `content` takes this with
    // it.
    //
    // ── What cannot reach it, and whose exclusion that is ──
    //
    // A table, a horizontal rule, an image and a link with no text are **not
    // blank for turndown at all**: `TABLE` and `A` are on its
    // `meaningfulWhenBlank` list, `HR` and `IMG` on its void list, and a node
    // holding any of them is non-blank by the same rule. So a task item whose
    // whole body is one of those never reaches this hook. **That exclusion is
    // turndown's rather than ours**, and it is asserted below against a
    // service that has never heard of this repository — a reader must not have
    // to infer the domain from the cases someone happened to measure.
    const stock = () => new TurndownService({ codeBlockStyle: 'fenced', fence: '```' });
    const taskItemHolding = (inner: string) =>
      `<ul data-type="taskList"><li data-type="taskItem" data-checked="false">${inner}</li></ul>`;

    // The line that used to assert the opposite, kept in that shape so the
    // amendment is legible as one.
    expect(markdownToHtml('- [ ] todo\n\n  ```\n  ```')).not.toContain('<input');

    // Reached, and correct: the closure's shapes, at depth zero and one.
    expect(roundtrip('- [ ] ```\n  ```')).toBe('- [ ] ```\n  ```');
    expect(roundtrip('- [ ] ```js\n  ```')).toBe('- [ ] ```js\n  ```');
    expect(roundtrip('- [ ] > ```\n  > ```')).toBe('- [ ] > ```\n  > ```');
    expect(roundtrip('- [ ] - ```\n    ```')).toBe('- [ ] - ```\n    ```');
    expect(roundtrip('> - [ ] ```\n>   ```')).toBe('> - [ ] ```\n>   ```');

    // Blank under turndown's rule — a stock service drops the whole item, which
    // is the loss this branch exists to prevent.
    for (const inner of [
      '<pre><code></code></pre>',
      '<pre><code class="language-js"></code></pre>',
      '<blockquote><pre><code></code></pre></blockquote>',
      '<ul><li><pre><code></code></pre></li></ul>',
    ]) {
      expect(stock().turndown(taskItemHolding(inner))).toBe('');
    }

    // Not blank under that same rule, so unreachable here whatever this
    // repository does: a stock service keeps the item.
    for (const inner of [
      '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
      '<hr>',
      '<img src="x.png">',
      '<a href="x"></a>',
    ]) {
      expect(stock().turndown(taskItemHolding(inner))).not.toBe('');
    }
  });

  it('writes what turndown itself writes for every container but the one holding a fence', () => {
    // The same "narrow" test the fence half makes, one level up: a document
    // through a service that has never heard of this fix differs in exactly
    // the two places the fence used to be dropped from. A container holding
    // an empty paragraph is written as its marker since #564, so the row
    // holds a paragraph, which turndown and this fix alike leave alone.
    const html =
      '<p>a</p><blockquote><pre><code></code></pre></blockquote>' +
      '<p></p><ul><li><pre><code></code></pre></li></ul><p>b</p>';
    const untouched = new TurndownService({ codeBlockStyle: 'fenced', fence: '```' }).turndown(
      html,
    );
    expect(untouched).toBe('a\n\nb');
    expect(htmlToMarkdown(html)).toBe('a\n\n> ```\n> ```\n\n- ```\n  ```\n\nb');
  });
});
