import { afterEach, describe, expect, it } from 'vitest';
import requirements from '../../REQUIREMENTS.md?raw';
import { createEditor, type EditorInstance } from './setup';

/**
 * #97 at the level the user meets it: open a numbered document, change
 * nothing, save — and every heading should not gain a backslash (R-C2).
 *
 * Turndown escapes a text node that begins with digits and a full stop, so
 * `## 1. Product statement` was written back as `## 1\. Product statement`.
 * Measured on `0ec52ed` through `createEditor` + `setMarkdown` +
 * `getMarkdown`: every heading in the first list came back changed, and
 * `REQUIREMENTS.md` came back with **10** escaped full stops it never had.
 *
 * The escape is withheld only where a list cannot begin — a heading and a
 * table cell take inline content and nothing else. Everywhere block content
 * is allowed the backslash stays, and the second half of this file is that
 * floor: a sentence that opens with a year must not become a list.
 *
 * The pair-level half is in `markdown/roundtrip.test.ts`. This file exists
 * because the blind spot #84 named is real — `roundtrip.test.ts` never builds
 * an editor, and every finding since #42 has come through the level it does
 * not cover.
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

describe('a numbered heading gains no backslash (#97)', () => {
  it.each([
    ['a numbered H1', '# 1. Intro'],
    ['a numbered H2', '## 1. Product statement'],
    ['a numbered H3', '### 1. Deeper'],
    ['the deepest heading the editor has', '#### 1. Deep'],
    ['a heading whose number could start a list', '## 1990. A year.'],
    ['a heading with an element after the number', '## 1. **Bold** thing'],
    ['a heading numbered with several digits', '## 10. Ten'],
  ])('leaves %s byte-identical', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });

  it('leaves a numbered table cell without a backslash', () => {
    // A GFM cell holds inline content only, so nothing in one can open a list.
    // The column padding is AgentEd's own spelling (#93), so this asserts the
    // cells, not the widths.
    const editor = editorWith('| 1. x | y |\n| --- | --- |\n| 2. a | b |');
    const saved = editor.getMarkdown();
    expect(saved).toContain('| 1. x |');
    expect(saved).toContain('| 2. a |');
    expect(saved).not.toContain('\\.');
  });

  it('writes a heading built in the editor without a backslash', () => {
    // Not parsed from a file: the same heading typed into the document. The
    // fix is anchored to the node, so it applies wherever the heading came
    // from.
    const editor = editorWith('');
    editor.editor.commands.setContent('<h2>1. Product statement</h2>');
    expect(editor.getMarkdown().trim()).toBe('## 1. Product statement');
  });
});

describe('the floor — where a list can begin, the escape stays', () => {
  // Each source is the *escaped* spelling, because that is the only way to
  // write these sentences: `1990. It was a good year.` unescaped is an
  // ordered list starting at 1990.
  it.each([
    ['a paragraph opening with a year', '1990\\. It was a good year.'],
    ['a paragraph opening with a small number', '1\\. It was a good year.'],
    ['a blockquote opening with a year', '> 1990\\. A year.'],
    ['a list item whose body opens with a year', '- 1990\\. A year.'],
  ])('keeps %s escaped', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });

  it.each([
    ['a paragraph', '1990\\. It was a good year.'],
    ['a blockquote body', '> 1990\\. A year.'],
    ['a list item body', '- 1990\\. A year.'],
  ])('re-opens %s as itself, not as an ordered list', (_label, markdown) => {
    // What the backslash is actually for. Saving is only half of it: the file
    // must also read back as the block it was, and an `<ol start="1990">`
    // here would mean a sentence had turned into a list between two saves
    // nobody edited.
    const saved = editorWith(markdown).getMarkdown().trim();
    const reread = editorWith(saved);
    expect(reread.editor.getHTML()).not.toContain('<ol');
    expect(reread.getMarkdown().trim()).toBe(saved);
  });

  it('writes a paragraph built in the editor with its backslash', () => {
    // The case that proves the fix did not over-correct: text typed as a
    // paragraph, never as a list. Unescaped, the next open would read it as
    // an ordered list starting at 1990.
    const editor = editorWith('');
    editor.editor.commands.setContent('<p>1990. It was a good year.</p>');
    const saved = editor.getMarkdown().trim();
    expect(saved).toBe('1990\\. It was a good year.');

    const reread = editorWith(saved);
    expect(reread.editor.getHTML()).not.toContain('<ol');
  });

  it.each([
    ['an ordered list', '1. first\n2. second'],
    ['an ordered list starting past 1', '3. third\n4. fourth'],
  ])('still writes %s as a list', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
    expect(editor.editor.getHTML()).toContain('<ol');
  });

  it('never writes a numbered line that reads back as a list', () => {
    // A heading level the editor does not have (`heading: { levels: [1..4] }`
    // in `setup.ts`) arrives as a paragraph, and there the backslash is
    // load-bearing. Asserted as the property rather than as bytes, so it stays
    // true whichever block the text ends up in.
    const saved = editorWith('##### 1990. A year.').getMarkdown().trim();
    expect(editorWith(saved).editor.getHTML()).not.toContain('<ol');
  });
});

describe('REQUIREMENTS.md, opened and saved unedited', () => {
  // #97's acceptance criterion, and the reason this issue is ranked where it
  // is: with the numbered headings quiet, the differences left in this file
  // are #84 (marks re-nested around inline code and links) and R-C2's
  // recorded soft-break exception. On `0ec52ed` this file came back with 10
  // escaped full stops it never had.
  const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

  it('writes exactly the escaped full stops the source had', () => {
    // Equal, not merely fewer: a file may legitimately hold an escaped full
    // stop — a paragraph that opens with a year — and this must neither add
    // one nor take one away.
    const editor = editorWith(requirements);
    expect(count(editor.getMarkdown(), /\\\./g)).toBe(count(requirements, /\\\./g));
  });

  it('keeps every numbered section heading a heading', () => {
    const editor = editorWith(requirements);
    const saved = editor.getMarkdown();
    expect(saved).toContain('## 1. Product statement');
    expect(saved).toContain('## 2. Core requirements — the editor');
    // No heading *line* opens with an escaped number. Asserted on the line
    // shape rather than on a substring, because this file quotes
    // `## 1\. Product statement` inside a code span while documenting the
    // exception — and a code span keeps its backslash, correctly.
    const escapedHeadings = saved.split('\n').filter((line) => /^#+ \d+\\\./.test(line));
    expect(escapedHeadings).toEqual([]);
  });
});
