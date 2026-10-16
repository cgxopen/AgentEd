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

describe('an empty first item under the paragraph of its item (#564, owner decision D3)', () => {
  // Written on the line under the paragraph, a lone `-` is a setext underline
  // and reads back as a heading, and GitHub reads a lone `*`, `+` or `1.` there
  // as text continuing the paragraph. So the nested list is written a blank
  // line under the paragraph, which `marked` and GitHub both read as the item,
  // and the editor still reads the list around it as tight.
  it.each([
    ['in a bullet item', '- foo\n\n  -\n'],
    ['with an item after it', '- foo\n\n  -\n  - x\n'],
    ['with an item after the outer one', '- foo\n\n  -\n- bar\n'],
    ['in an ordered item', '1. foo\n\n   1.\n2. bar\n'],
    ['in a quote', '> - foo\n>\n>   -\n'],
  ])('keeps it %s byte for byte', (_label, markdown) => {
    const once = saved(markdown);
    expect(once).toBe(markdown);
    expect(saved(once)).toBe(once);
  });

  it('reads the list around it back as tight', () => {
    expect(editorWith('- foo\n\n  -\n- bar\n').editor.getHTML()).toBe(
      '<ul><li><p>foo</p><ul data-adjacent="1"><li><p></p></li></ul></li><li><p>bar</p></li></ul>',
    );
  });

  it('writes the spelling GitHub reads as text with the blank line', () => {
    // `marked` reads both as an empty item and GitHub as the paragraph text.
    expect(saved('- foo\n  *\n')).toBe('- foo\n\n  *\n');
    expect(saved('1. foo\n   1.\n')).toBe('1. foo\n\n   1.\n');
  });

  it('writes one made by Tab under an item', () => {
    const editor = editorWith('- foo\n-\n');
    editor.editor.commands.setTextSelection(editor.editor.state.doc.content.size - 3);
    expect(editor.editor.commands.sinkListItem('listItem')).toBe(true);
    expect(editor.getMarkdown()).toBe('- foo\n\n  -');
  });

  it.each([
    // Kept since #601: the checklist item writes the blank line the file had,
    // which is what keeps the item in a bullet item, and the checkbox with it.
    ['alone', '- [ ] foo\n\n  -\n'],
    ['with an item after it', '- [ ] foo\n\n  -\n  - x\n'],
    ['with a task item after its list', '- [ ] foo\n\n  -\n- [ ] bar\n'],
  ])('keeps it in a checklist item, %s', (_label, markdown) => {
    expect(saved(markdown)).toBe(markdown);
  });
});
