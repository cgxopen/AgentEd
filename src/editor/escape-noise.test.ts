import { afterEach, describe, expect, it } from 'vitest';
import readme from '../../README.md?raw';
import requirements from '../../REQUIREMENTS.md?raw';
import { createEditor, type EditorInstance } from './setup';

/**
 * #90 at the level the user meets it: open a document, change nothing, save —
 * and the file should not gain backslashes nobody typed (R-C2).
 *
 * Turndown escapes every `_` and every backtick in a text node. Measured on
 * `86bc260` through `createEditor` + `setMarkdown` + `getMarkdown`, every case
 * in the first list came back changed: `cl100k_base` → `cl100k\_base`,
 * `snake_case` → `snake\_case`, a bare ``` quoted in prose → `` \`\`\` ``.
 *
 * The pair-level half is in `markdown/roundtrip.test.ts`; the function itself
 * is in `markdown/escape.test.ts`. This file exists because the blind spot
 * #84 named is real — `roundtrip.test.ts` never builds an editor, and every
 * finding since #42 has come through the level it does not cover.
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

describe('an untouched save adds no backslash (#90)', () => {
  it.each([
    ['an identifier with one underscore', 'The tokenizer is cl100k_base here.'],
    ['snake_case in a sentence', 'Call snake_case now.'],
    ['two underscores in one word', 'Try a_b_c please.'],
    ['a double underscore inside a word', 'A foo__bar name.'],
    ['a file name in prose', 'Open file_name.md next.'],
    ['a bare triple backtick quoted in text', 'A ``` in running text.'],
    ['a lone backtick', 'one ` backtick'],
    ['an identifier inside bold', '**cl100k_base** matters.'],
    ['an identifier inside a link', '[cl100k_base](https://x) matters.'],
    ['an identifier in a list item', '- uses cl100k_base'],
    ['an identifier in a heading', '## About cl100k_base'],
  ])('leaves %s byte-identical', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });
});

describe('the floor — what must still be escaped, still is', () => {
  it.each([
    ['underscores the file had already escaped', 'a \\_foo\\_ b'],
    ['asterisks the file had already escaped', 'a \\*not bold\\* b'],
    ['an underscore that could open emphasis', 'see \\_foo here'],
    ['an underscore that could close emphasis', 'see foo\\_ here'],
    ['an underscore run at both edges of a word', 'a \\_x_y\\_ b'],
    ['emphasis spelled with asterisks', 'a *foo* b'],
    ['intraword emphasis with asterisks', 'a foo*bar*baz b'],
    ['strong', 'a **bold** b'],
    ['inline code holding an underscore', 'use `snake_case` here'],
    ['a fenced block holding an underscore', '```js\nconst a_b = 1;\n```'],
  ])('keeps %s unchanged', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });

  it('writes a literal _foo_ so that re-reading it does not make italics', () => {
    // The case that proves the narrowing did not over-correct: text typed in
    // the editor as plain characters, never as emphasis. If it came back
    // unescaped, the next open would read it as `<em>` and the document would
    // have changed meaning between two saves nobody edited.
    const editor = editorWith('');
    editor.editor.commands.setContent('<p>a _foo_ b</p>');
    const saved = editor.getMarkdown().trim();
    expect(saved).toBe('a \\_foo\\_ b');

    const reread = editorWith(saved);
    expect(reread.editor.getHTML()).not.toContain('<em>');
    expect(reread.getMarkdown().trim()).toBe(saved);
  });
});

describe('two real documents, opened and saved unedited', () => {
  // Neither is byte-identical yet, and this asserts only the share #90 owns.
  // What remains, measured on this branch:
  //   README.md      — the shortcuts table, re-padded (+628 bytes): #93.
  //                    Two badge rows and a two-line sign-off collapse to one
  //                    line each at no byte cost: R-C2's soft-break exception.
  //   REQUIREMENTS.md — `**` re-nested around inline code and links: #84.
  //                    `## 1.` written as `## 1\.`: turndown's `^(\d+)\. `
  //                    rule, the same class of noise as #90 but a different
  //                    entry in the table and out of this issue's scope —
  //                    reported on the PR, not changed here.
  //                    A code span's delimiter run shortened to the minimum
  //                    width that still closes it: pre-existing and stable.
  it.each([
    ['README.md', readme],
    ['REQUIREMENTS.md', requirements],
  ])('adds no escaped underscore or backtick to %s', (_name, source) => {
    const editor = editorWith(source);
    const saved = editor.getMarkdown();
    const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

    // Equal, not merely smaller: a file may legitimately contain escapes, and
    // this fix must neither add them nor take the existing ones away.
    expect(count(saved, /\\_/g)).toBe(count(source, /\\_/g));
    expect(count(saved, /\\`/g)).toBe(count(source, /\\`/g));
  });

  it('keeps the identifiers README names in prose', () => {
    const editor = editorWith(readme);
    const saved = editor.getMarkdown();
    expect(saved).toContain('cl100k_base');
    expect(saved).not.toContain('cl100k\\_base');
  });
});
