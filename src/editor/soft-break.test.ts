import { afterEach, describe, expect, it } from 'vitest';
import readme from '../../README.md?raw';
import { createEditor, type EditorInstance } from './setup';

/**
 * #89 — a soft line break inside a paragraph is a **space**, never nothing.
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
 * this.
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

describe('a soft line break between two inline elements stays a space (#89)', () => {
  it.each([
    ['two links', '[A](https://a)\n[B](https://b)', '[A](https://a) [B](https://b)'],
    [
      'two badges — a link wrapping an image, the README case',
      '[![A](a.png)](https://a)\n[![B](b.png)](https://b)',
      '[![A](a.png)](https://a) [![B](b.png)](https://b)',
    ],
    ['two bold words', '**a**\n**b**', '**a** **b**'],
    ['two code spans', '`a`\n`b`', '`a` `b`'],
    ['text then an element', 'see\n[B](https://b)', 'see [B](https://b)'],
    ['an element then text', '[A](https://a)\nsee', '[A](https://a) see'],
    ['bold then italics', '**a**\n*b*', '**a** *b*'],
  ])('keeps %s apart on open → save', (_label, markdown, expected) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(expected);
  });

  it('holds two separate marks, not one merged word, after open', () => {
    // The byte-level assertion above would also pass if the two words were
    // merged and the serializer re-split them; this says the document model
    // itself kept them apart, which is what the reader sees on screen.
    const editor = editorWith('**a**\n**b**');
    expect(editor.editor.getHTML()).toBe('<p><strong>a</strong> <strong>b</strong></p>');
  });
});

describe('KNOWN EXCEPTION — a soft line break is written as a space (R-C2)', () => {
  it('collapses a wrapped paragraph into one line', () => {
    // Recorded in REQUIREMENTS under R-C2. CommonMark reads a soft break as a
    // space, so nothing changes when the file is rendered — but the bytes do,
    // and the editor has no soft-break node that could carry the wrap back.
    const editor = editorWith('first line\nsecond line');
    expect(editor.getMarkdown().trim()).toBe('first line second line');
  });

  it('collapses a three-line hard-wrapped paragraph the same way', () => {
    const editor = editorWith('one two\nthree four\nfive six');
    expect(editor.getMarkdown().trim()).toBe('one two three four five six');
  });
});

describe('what this change does not touch', () => {
  it('leaves a hard break (two trailing spaces) byte-identical', () => {
    const editor = editorWith('a  \nb');
    expect(editor.getMarkdown().trim()).toBe('a  \nb');
  });

  it('parses a backslash hard break as a break', () => {
    // `\`⏎ and two-spaces⏎ are the same hard break; the mark carries no memory
    // of which spelling the file used, so the backslash form is written back
    // with two spaces. Pre-existing on `230b4d7`, measured there, unchanged by
    // this PR — reported rather than fixed, since it is not this issue.
    const editor = editorWith('a\\\nb');
    expect(editor.editor.getHTML()).toBe('<p>a<br>b</p>');
    expect(editor.getMarkdown().trim()).toBe('a  \nb');
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
