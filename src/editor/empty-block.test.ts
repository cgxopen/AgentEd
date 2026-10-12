import { afterEach, describe, expect, it } from 'vitest';
import { applyLineConventions, detectLineConventions } from '../formats/line-conventions';
import { markdownToHtml } from './markdown/parse';
import { htmlToMarkdown } from './markdown/serialize';
import { createEditor, type EditorInstance } from './setup';

/**
 * An empty heading, quote and list item survive an unedited save (#564).
 *
 * Measured on `0ccf572` at both levels before anything was written: `marked`
 * and DOMPurify keep each of them, and the editor holds each, a heading with
 * no content, a quote and an item each holding an empty paragraph. The
 * serializer dropped them through turndown's blank rule, so `## ` came back as
 * nothing and `- foo`, `-`, `- bar` came back as two items a blank line apart:
 * a loose list, a change of document and not only of bytes. Each is now
 * written as its marker, by `markdown/empty-block.ts`.
 */
const editors: EditorInstance[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = '';
});

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(markdown);
  editors.push(editor);
  return editor;
}

/** Open `markdown`, change nothing, and return what a save writes. */
function saved(markdown: string): string {
  return applyLineConventions(editorWith(markdown).getMarkdown(), detectLineConventions(markdown));
}

/** Delete the text `text` from the document, the way a person selects it and presses Delete. */
function deleteText(editor: EditorInstance, text: string): void {
  const { state, view } = editor.editor;
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === text) at = pos;
    return at === -1;
  });
  expect(at, `no text node ${text}`).toBeGreaterThan(-1);
  view.dispatch(state.tr.delete(at, at + text.length));
}

describe('an empty heading, quote or item is written back as the file wrote it (#564)', () => {
  it.each([
    ['an empty heading', '##\n'],
    ['an empty heading of each level', '#\n\n##\n\n###\n\n####\n\n#####\n\n######\n'],
    ['an empty heading between paragraphs', 'a\n\n###\n\nb\n'],
    ['an empty quote, CommonMark example 239', '>\n'],
    ['an empty quote spelled with a space', 'a\n\n> \n\nb\n'],
    ['an empty quote inside a quote', '> a\n>\n> >\n'],
    ['an empty middle item, CommonMark example 281', '- foo\n-\n- bar\n'],
    ['an empty ordered item, CommonMark example 283', '1. foo\n2.\n3. bar\n'],
    ['an empty item alone, CommonMark example 284', '*\n'],
    ['an empty item in a list numbered with one number', '1. foo\n1.\n1. bar\n'],
    ['an empty item after a parenthesis', '1) foo\n2)\n'],
    ['an empty item with a plus', '+ a\n+\n'],
    ['an empty last item', '- a\n-\n'],
    ['an empty item in a loose list', '- a\n\n-\n\n- c\n'],
    ['an empty item inside a quote', '> - a\n> -\n'],
    ['all three in one document', '##\n\nfoo\n\n>\n\n-\n'],
  ])('keeps %s byte for byte', (_label, markdown) => {
    const once = saved(markdown);
    expect(once).toBe(markdown);
    expect(saved(once)).toBe(once);
  });

  it('writes the same at the pair level, where the editor is not involved', () => {
    for (const markdown of ['##', '>', '- foo\n-\n- bar', '1. foo\n2.\n3. bar', '*']) {
      expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
    }
  });

  it('writes no space after a marker that is the whole line', () => {
    // `-   ` and `## ` are read as the same empty constructs, CommonMark
    // examples 282 and 79, and are written without the trailing spaces.
    expect(saved('- foo\n-   \n- bar\n')).toBe('- foo\n-\n- bar\n');
    expect(saved('## \n')).toBe('##\n');
    // And at the end of the document turndown trims what ends its output, as
    // it does after the last line of any document, so `> ` there is `>`.
    expect(saved('> \n')).toBe('>\n');
  });
});

describe('what an empty construct made in the editor is written as (#564, Q4)', () => {
  it('writes a middle item emptied in the editor as its marker, and reopens it', () => {
    const editor = editorWith('- one\n- two\n- three\n');
    deleteText(editor, 'two');
    const written = editor.getMarkdown();
    // On `0ccf572`: `- one`, a blank line, `- three`, two items of a loose list.
    expect(written).toBe('- one\n-\n- three');
    expect(editorWith(written).editor.getHTML()).toBe(editor.editor.getHTML());
  });

  it('writes a heading left empty as its hashes, and reopens it', () => {
    const editor = editorWith('## Title\n\nBody\n');
    deleteText(editor, 'Title');
    const written = editor.getMarkdown();
    // On `0ccf572`: `Body` alone, the heading gone.
    expect(written).toBe('##\n\nBody');
    expect(editorWith(written).editor.getHTML()).toBe('<h2></h2><p>Body</p>');
  });

  it('writes a quote emptied in the editor as its marker, with the space a quote it made takes', () => {
    const editor = editorWith('> words\n\nafter\n');
    deleteText(editor, 'words');
    expect(editor.getMarkdown()).toBe('> \n\nafter');
  });
});

describe('the empty item that would underline the line above it is left as before (#564)', () => {
  // A lone `-` on the line directly under a line of text is a setext
  // underline: `- foo` over `  -` reads back as a heading inside the item, in
  // `marked` and on GitHub alike. The serializer writes a nested list on the
  // line under the paragraph of its item, so the empty first item of a nested
  // `-` list is dropped as it was on `0ccf572`, and the owner decides on #564
  // what it becomes. Each expected value is what `0ccf572` writes.
  it.each([
    ['in a bullet item', '- foo\n\n  -\n', '- foo\n'],
    ['in a checklist item', '- [ ] foo\n\n  -\n', '- [ ] foo\n'],
    ['in a quote', '> - foo\n>\n>   -\n', '> - foo\n'],
    ['with an item after it', '- [ ] foo\n\n  -\n  - x\n', '- [ ] foo\n  - x\n'],
  ])('%s', (_label, markdown, expected) => {
    expect(saved(markdown)).toBe(expected);
  });

  it('writes the empty item where nothing can underline', () => {
    // A `*` cannot underline, and an ordered marker is no underline at all.
    expect(saved('- foo\n  *\n')).toBe('- foo\n  *\n');
    expect(saved('1. foo\n   1.\n')).toBe('1. foo\n   1.\n');
  });
});
