import { afterEach, describe, expect, it } from 'vitest';
import readme from '../../README.md?raw';
import { createEditor, type EditorInstance } from './setup';

/**
 * #89 — a soft line break inside a paragraph is never nothing. It was a
 * **space** from #89 to #571, and is the newline the file had since #571.
 *
 * On `230b4d7` a soft break was handled two different ways depending on what
 * stood on either side of it. Between two text characters it collapsed to a
 * space, the way CommonMark reads it. Between two inline *elements* it was
 * **deleted**, because every string handed to `setContent` went through
 * TipTap's `elementFromString`, whose `removeWhitespaces` strips any text node
 * that is exactly a newline — and in `marked`'s output a soft break between
 * two elements is exactly such a node. ProseMirror then merged the adjacent
 * text carrying identical marks, so `**a**`⏎`**b**` opened as
 * `<strong>ab</strong>` and saved as `**ab**`: two words merged into one, in
 * the user's file (R-C2).
 *
 * Measured on `230b4d7` through `createEditor` + `setMarkdown` + `getMarkdown`
 * — every case in the first table came back glued:
 * `[A](https://a)[B](https://b)`, `**ab**`, `` `ab` ``, the two badges with
 * nothing between them.
 *
 * These go through the **editor**, not through the parser/serializer pair:
 * `markdown/roundtrip.test.ts` never builds one, which is why it could not see
 * this (it now carries the one-line pair-level case as well).
 *
 * **The helper reached further than the soft break.** It stripped such a node
 * at every depth, and `marked` emits them between list items, around table
 * rows, inside blockquotes and inside `<pre><code>` too. Those contexts are
 * measured here on both routes rather than reasoned about: ProseMirror ignores
 * whitespace-only text outside inline context, so they save byte-identically —
 * which is the claim, now pinned. The one place the node genuinely survives
 * into the document model where it did not before is an empty fenced block,
 * whose saved bytes were `''` on both sides of #89 for a reason that belonged
 * to the serializer — pinned here as observed, filed as #94 and fixed there,
 * so the assertion below now reads the fence rather than nothing.
 */
let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('a soft line break between two inline elements keeps them apart (#89, #571)', () => {
  // #89 made the break a space where it had been nothing. Since #571 it is the
  // newline the file had, so these come back byte for byte; the words still
  // stand apart, which is what #89 was about.
  it.each([
    ['two links', '[A](https://a)\n[B](https://b)'],
    [
      'two badges — a link wrapping an image, the README case',
      '[![A](a.png)](https://a)\n[![B](b.png)](https://b)',
    ],
    ['two bold words', '**a**\n**b**'],
    ['two code spans', '`a`\n`b`'],
    ['text then an element', 'see\n[B](https://b)'],
    ['an element then text', '[A](https://a)\nsee'],
    ['bold then italics', '**a**\n*b*'],
  ])('keeps %s apart on open → save, on their two lines', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });

  it('holds two separate marks with the break between them, not one merged word', () => {
    // The byte-level assertion above would also pass if the two words were
    // merged and the serializer re-split them; this says the document model
    // itself kept them apart, which is what the reader sees on screen.
    const editor = editorWith('**a**\n**b**');
    expect(editor.editor.getHTML()).toBe(
      '<p><strong>a</strong><span data-soft-break=""> </span><strong>b</strong></p>',
    );
    expect(editor.editor.getText()).toBe('a b');
  });
});

describe('a soft line break is written as the newline the file had (#571)', () => {
  // Until #571 a known R-C2 exception: the line was joined to the one above.
  it('keeps a wrapped paragraph on its two lines', () => {
    const editor = editorWith('first line\nsecond line');
    expect(editor.getMarkdown().trim()).toBe('first line\nsecond line');
  });

  it('keeps a three-line hard-wrapped paragraph on its three lines', () => {
    const editor = editorWith('one two\nthree four\nfive six');
    expect(editor.getMarkdown().trim()).toBe('one two\nthree four\nfive six');
  });
});

describe('what this change does not touch', () => {
  it('leaves a hard break (two trailing spaces) byte-identical', () => {
    const editor = editorWith('a  \nb');
    expect(editor.getMarkdown().trim()).toBe('a  \nb');
  });

  it('parses a backslash hard break as a break, and keeps its spelling', () => {
    // `\`⏎ and two-spaces⏎ are the same hard break. Until #584 the backslash
    // form was written back with two spaces; the hard break now carries the
    // spelling the file used, as it does for a `br` tag since #577.
    const editor = editorWith('a\\\nb');
    expect(editor.editor.getHTML()).toBe('<p>a<br data-br-spelling="\\">b</p>');
    expect(editor.getMarkdown().trim()).toBe('a\\\nb');
  });

  it.each([
    ['a fenced block with a blank line inside', '```js\nconst a = 1;\n\nconst b = 2;\n```'],
    ['a fenced block whose content starts with a blank line', '```\n\nx\n```'],
  ])('leaves %s unchanged', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });

  it('still separates two elements that had a literal space between them', () => {
    const editor = editorWith('**a** **b**');
    expect(editor.getMarkdown().trim()).toBe('**a** **b**');
  });

  it('keeps an empty fenced block, on both routes', () => {
    // The one case where `removeWhitespaces` reached a *block* context that
    // matters: `marked` reads ```⏎⏎``` as `<pre><code>\n</code></pre>`, whose
    // only child is a text node that is exactly a newline. On `230b4d7` the
    // helper deleted it and the editor held an empty `<code>`; here the
    // newline survives into the document model.
    //
    // **This assertion is inverted from the one #89 left behind**, which
    // pinned the empty block being dropped as OBSERVED and filed it as #94.
    // The saved bytes were `''` on both sides of that PR; they are now the
    // fence, on both sides, because the serializer no longer writes nothing
    // for a block with no visible content. The document model is unchanged —
    // which is the point: #89's finding stands, and what #94 changed is only
    // what is written for it. Since #625 the blank line is written back too,
    // from a stamp the parse sets (see `markdown/empty-fence.ts`).
    const editor = editorWith('```\n\n```');
    expect(editor.editor.getJSON()).toMatchObject({
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: '\n' }] }],
    });
    expect(editor.getMarkdown().trim()).toBe('```\n\n```');
  });
});

describe('the block contexts the helper also reached are unmoved', () => {
  // Measured, not assumed: `marked` puts a bare-newline text node between
  // `</li>` and `<li>`, around `<thead>`/`<tr>` and inside `<blockquote>`, all
  // of which the helper used to strip. Each of these round-trips to the same
  // bytes as it did on `230b4d7` — verified there by reverting `setup.ts` and
  // re-running this file.
  it.each([
    ['a nested tight bullet list', '- a\n  - b\n  - c\n- d', '- a\n  - b\n  - c\n- d'],
    ['a nested ordered list', '1. a\n   1. b\n   2. c\n2. d', '1. a\n   1. b\n   2. c\n2. d'],
    ['a task list', '- [ ] a\n- [x] b', '- [ ] a\n- [x] b'],
    ['a blockquote', '> a quote', '> a quote'],
    ['a blockquote holding a list', '> - a\n> - b', '> - a\n> - b'],
    // A GFM table used to come back padded — the R-C2 exception this file
    // recorded when #89 landed. Since #93 the table is written the way the
    // file wrote it, so the row now means what its name always said.
    ['a GFM table', '| a | b |\n| --- | --- |\n| 1 | 2 |', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
  ])('leaves %s exactly as it was', (_label, markdown, expected) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(expected);
  });
});

describe("this repository's README survives its own badge row (#89)", () => {
  // Equality is not the assertion: `README.md` also carries #90 (unnecessary
  // escaping of `_` and backticks) and the table re-padding recorded in R-C2,
  // so a round trip changes bytes for reasons that are not this issue. What is
  // asserted is what no longer happens — nothing is glued to a `)`.
  it('writes the three badges as three badges, separated', () => {
    const editor = editorWith(readme);
    const saved = editor.getMarkdown();
    const badges = saved.match(/\[!\[/g) ?? [];
    expect(badges).toHaveLength(3);

    for (const match of saved.matchAll(/\[!\[/g)) {
      const before = match.index === 0 ? '\n' : saved[match.index - 1];
      expect(before).toMatch(/[\s\n]/);
    }
    expect(saved).not.toContain(')[![');
  });

  it('glues no two inline elements that were on consecutive lines', () => {
    const editor = editorWith(readme);
    const saved = editor.getMarkdown();
    // A closing link/image paren immediately followed by the opening bracket
    // of another one is the shape the deletion produced.
    expect(saved).not.toMatch(/\)\[/);
    expect(saved).not.toMatch(/\)!\[/);
  });
});
