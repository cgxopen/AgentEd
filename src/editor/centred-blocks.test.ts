import { afterEach, describe, expect, it, vi } from 'vitest';
import { CENTRED_CLASS, centresByItsHtml } from './centred-blocks';
import { HTML_BLOCK_SOURCE } from './kept-html-table';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * A block the file centres with its HTML is drawn centred, while the save
 * keeps the wrapper (#699). The class is the observable half here: happy-dom
 * computes no layout, so that `text-align: center` centres what the class is
 * on is measured in Chromium on the issue and confirmed by the owner pass.
 */
const FIXTURE = [
  '# Plain heading',
  '',
  '<center>',
  '<img src="pic.png" alt="centre element image">',
  '</center>',
  '',
  '<h1 align="center">Centred heading</h1>',
  '',
  '<p align="center">',
  'A centred paragraph, its tags on their own lines.',
  '</p>',
  '',
  '<div align="center">',
  '',
  'A centred paragraph, shape five with blank lines.',
  '',
  '</div>',
  '',
  '<p align="right">',
  'A paragraph aligned right.',
  '</p>',
  '',
  'Plain paragraph at the left.',
  '',
].join('\n');

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
});

function editorWith(markdown: string): EditorInstance {
  const element = document.createElement('div');
  document.body.appendChild(element);
  instance = createEditor(element);
  instance.setMarkdown(markdown);
  return instance;
}

/** The top-level blocks as drawn: centred or not, and their text. */
function drawn(editor: EditorInstance): string[] {
  const { view, state } = editor.editor;
  const lines: string[] = [];
  state.doc.forEach((node, offset) => {
    const element = view.nodeDOM(offset);
    const centred = element instanceof HTMLElement && element.classList.contains(CENTRED_CLASS);
    const image = node.firstChild?.type.name === 'image' ? node.firstChild.attrs.alt : '';
    lines.push(`${centred ? 'centred' : 'left'}: ${node.textContent.trim() || image}`);
  });
  return lines;
}

/** Put the caret at `offset` inside the text `text`. */
function caretIn(editor: EditorInstance, text: string, offset: number): void {
  let at = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(text)) at = pos + node.text.indexOf(text);
  });
  if (at < 0) throw new Error(`text not found: ${text}`);
  editor.editor.commands.setTextSelection(at + offset);
}

describe('which bytes centre their block (#699)', () => {
  it.each([
    ['<p align="center">x</p>', true],
    ['<div align="center">\n\n**x**\n\n</div>', true],
    ["<p align='center'>x</p>", true],
    ['<p align=center>x</p>', true],
    ['<P ALIGN="CENTER">x</P>', true],
    ['<h1 align="center">x</h1>', true],
    ['<h6 align="center">x</h6>', true],
    ['<center>\n<img src="a.png">\n</center>', true],
    ['<p align="center">a</p>\n<p align="center">b</p>', true],
    ['<p align="center">a</p>\n</br>', true],
    ['<p align="right">x</p>', false],
    ['<div align="left">x</div>', false],
    ['<p>x</p>', false],
    ['<a href="x"><img src="a.png"></a>', false],
    ['<details><summary>s</summary>x</details>', false],
    ['<p><img src="a.png" align="center"></p>', false],
    ['<h1 align="center">a</h1>\n<p>b</p>', false],
  ])('%s', (source, expected) => {
    expect(centresByItsHtml(source)).toBe(expected);
  });
});

describe('a block centred by its HTML is drawn centred while it is unedited (#699)', () => {
  it('the centre element, the centred heading and both paragraph shapes; not right, not plain', () => {
    const editor = editorWith(FIXTURE);
    expect(drawn(editor)).toEqual([
      'left: Plain heading',
      'centred: centre element image',
      'centred: Centred heading',
      'centred: A centred paragraph, its tags on their own lines.',
      'centred: A centred paragraph, shape five with blank lines.',
      'left: A paragraph aligned right.',
      'left: Plain paragraph at the left.',
    ]);
  });

  it('a character typed in the heading draws it at the left, as the save will write it', () => {
    const editor = editorWith(FIXTURE);
    caretIn(editor, 'Centred heading', 7);
    editor.editor.commands.insertContent('X');
    expect(drawn(editor)[2]).toBe('left: CentredX heading');
    expect(editor.getMarkdown()).toContain('# CentredX heading');
  });

  it('the same character deleted again draws it centred again', () => {
    const editor = editorWith(FIXTURE);
    caretIn(editor, 'Centred heading', 7);
    editor.editor.commands.insertContent('X');
    editor.editor.commands.undo();
    expect(drawn(editor)[2]).toBe('centred: Centred heading');
    expect(editor.getMarkdown()).toContain('<h1 align="center">Centred heading</h1>');
  });

  it('the class reaches neither the file nor the HTML the editor serializes', () => {
    const editor = editorWith(FIXTURE);
    expect(editor.getMarkdown()).toBe(FIXTURE.replace(/\n$/, ''));
    expect(editor.editor.getHTML()).not.toContain(CENTRED_CLASS);
  });

  it('nor either flavour of a copy', () => {
    const editor = editorWith(FIXTURE);
    editor.editor.commands.selectAll();
    const { view } = editor.editor;
    const { dom, text } = view.serializeForClipboard(view.state.selection.content());
    expect(dom.innerHTML).not.toContain(CENTRED_CLASS);
    expect(text).toContain('<h1 align="center">Centred heading</h1>');
  });
});

describe('Enter inside a centred block (#699)', () => {
  it('in the middle: both halves at the left, and the save writes them without the wrapper', () => {
    const editor = editorWith(FIXTURE);
    caretIn(editor, 'its tags on', 0);
    editor.editor.commands.enter();
    expect(drawn(editor).slice(3, 5)).toEqual([
      'left: A centred paragraph,',
      'left: its tags on their own lines.',
    ]);
    expect(editor.getMarkdown()).toContain('A centred paragraph,\n\nits tags on their own lines.');
    expect(editor.getMarkdown()).not.toContain('<p align="center">');
  });

  it('in the middle: the new paragraph carries the bytes too, the reading of the issue', () => {
    const editor = editorWith(FIXTURE);
    caretIn(editor, 'its tags on', 0);
    editor.editor.commands.enter();
    const { doc } = editor.editor.state;
    expect(doc.child(3).attrs[HTML_BLOCK_SOURCE]).toBe(doc.child(4).attrs[HTML_BLOCK_SOURCE]);
    expect(typeof doc.child(4).attrs[HTML_BLOCK_SOURCE]).toBe('string');
  });

  it('at the end: the block stays centred and the new empty one is at the left', () => {
    const editor = editorWith(FIXTURE);
    caretIn(editor, 'own lines.', 10);
    editor.editor.commands.enter();
    expect(drawn(editor).slice(3, 5)).toEqual([
      'centred: A centred paragraph, its tags on their own lines.',
      'left: ',
    ]);
    expect(editor.getMarkdown()).toContain('<p align="center">\nA centred paragraph');
  });

  it('then undo: centred again', () => {
    const editor = editorWith(FIXTURE);
    caretIn(editor, 'its tags on', 0);
    editor.editor.commands.enter();
    editor.editor.commands.undo();
    expect(drawn(editor)[3]).toBe('centred: A centred paragraph, its tags on their own lines.');
  });
});

describe('bytes that read back as several blocks, a region (#699)', () => {
  const REGION = [
    'Above.',
    '',
    '<p align="center"><strong>One</strong></p>',
    '<p align="center">Two</p>',
    '',
    'Below.',
    '',
  ].join('\n');

  it('every block of the region is drawn centred', () => {
    const editor = editorWith(REGION);
    expect(drawn(editor)).toEqual(['left: Above.', 'centred: One', 'centred: Two', 'left: Below.']);
  });

  it('an edit to one of its blocks draws them all at the left', () => {
    const editor = editorWith(REGION);
    caretIn(editor, 'Two', 3);
    editor.editor.commands.insertContent('!');
    expect(drawn(editor)).toEqual(['left: Above.', 'left: One', 'left: Two!', 'left: Below.']);
  });

  it('a centred heading followed by a paragraph that is not centred is drawn at the left', () => {
    const editor = editorWith('<h1 align="center">Title</h1>\n<p>badges</p>\n');
    expect(drawn(editor).every((line) => line.startsWith('left'))).toBe(true);
  });
});

describe('the reference definitions the save reads the bytes with (#699, #604)', () => {
  const WITH_REFERENCE = [
    '<div align="center">',
    '',
    'See [the site][site].',
    '',
    '</div>',
    '',
    '[site]: https://example.com/a',
    '',
  ].join('\n');

  it('a centred block holding a reference link is drawn centred', () => {
    const editor = editorWith(WITH_REFERENCE);
    expect(drawn(editor)[0]).toBe('centred: See the site.');
    expect(editor.getMarkdown()).toContain('<div align="center">');
  });

  it('its definition changed, the save lets the wrapper go and it is drawn at the left', () => {
    const editor = editorWith(WITH_REFERENCE);
    caretIn(editor, 'example.com/a', 13);
    editor.editor.commands.insertContent('b');
    expect(editor.getMarkdown()).not.toContain('<div align="center">');
    expect(drawn(editor)[0]).toBe('left: See the site.');
  });
});
