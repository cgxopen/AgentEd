import { afterEach, describe, expect, it } from 'vitest';
import { clipboardSerializerWithToken } from '../clipboard-token';
import { cleanPastedHtml } from '../paste';
import { createEditor, type EditorInstance } from '../setup';
import { SPACER_ATTRIBUTE } from './spacer-paragraph';

/**
 * #606: a paragraph holding only `&nbsp;`, a spacer, is kept through an
 * unedited save. On `e194465` it was lost with its paragraph wherever it
 * stood. GitHub reads each row below as the original after the save, read
 * with cmark-gfm on the pull request; here the bytes are pinned.
 */

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

function save(markdown: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance?.destroy();
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return `${instance.getMarkdown().trim()}\n`;
}

function holds(markdown: string, expected: string = markdown): void {
  const once = save(markdown);
  expect(once, 'the first save').toBe(expected);
  expect(save(once), 'the second save').toBe(once);
}

describe('a spacer paragraph is kept', () => {
  it.each([
    ['between two paragraphs', 'Para.\n\n&nbsp;\n\nPara.\n'],
    ['under a raw HTML block', '<p align="center">x</p>\n\n&nbsp;\n\nPara.\n'],
    ['in a list item', '- a\n\n  &nbsp;\n\n  b\n'],
    ['in a quote', '> a\n>\n> &nbsp;\n>\n> b\n'],
    ['two of them on one line', 'Para.\n\n&nbsp;&nbsp;\n\nPara.\n'],
  ])('%s', (_name, markdown) => {
    holds(markdown);
  });

  it('writes a numeric reference to the same space as `&nbsp;`', () => {
    holds('Para.\n\n&#160;\n\nPara.\n', 'Para.\n\n&nbsp;\n\nPara.\n');
  });

  it('writes no spacer for a paragraph `marked` splits off a list item, as before', () => {
    // `marked` 15 cuts an item before a trailing U+00A0 and reads the character
    // as a paragraph of its own; the source holds no reference, so no marker.
    expect(save(`- a\n- b.${String.fromCharCode(0xa0)}\n\nNext.\n`)).toBe('- a\n- b.\n\nNext.\n');
  });

  it('leaves a non-breaking space inside text written as the character, as before', () => {
    holds('a&nbsp;b\n', 'a b\n');
  });

  it('writes the spacer as before in a document that carries the stand-in', () => {
    expect(save('x\n\n&nbsp;\n\nPara.\n')).toBe('x\n\nPara.\n');
  });
});

/** U+00A0, built from its code so the source shows which character it is. */
const NBSP = String.fromCharCode(0xa0);
const SPACER = 'Para.\n\n&nbsp;\n\nEnd.\n';

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance?.destroy();
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** The position of the non-breaking space the spacer paragraph holds. */
function spacerAt(editor: EditorInstance): number {
  let at = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === NBSP) at = pos;
  });
  return at;
}

function paste(editor: EditorInstance, data: Record<string, string>): void {
  const event = {
    clipboardData: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
      files: [],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = editor.editor;
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

describe('the marker is stamped by the parse alone (#447)', () => {
  it('is not believed from a document that spells it: the raw HTML is kept as bytes', () => {
    const markdown = 'Para.\n\n<p data-spacer=""> </p>\n\nEnd.';
    expect(editorWith(`${markdown}\n`).getMarkdown()).toBe(markdown);
  });

  it('is taken out of a paste from outside, which keeps no spacer', () => {
    expect(cleanPastedHtml(`<p ${SPACER_ATTRIBUTE}="">&nbsp;</p>`)).not.toContain(SPACER_ATTRIBUTE);
    const editor = editorWith('Start.\n');
    editor.editor.commands.focus('end');
    paste(editor, {
      'text/html': `<p>x</p><p ${SPACER_ATTRIBUTE}="">&nbsp;</p><p>y</p>`,
      'text/plain': `x\n${NBSP}\ny`,
    });
    expect(editor.getMarkdown()).toBe('Start.x\n\ny');
  });

  it('is kept by a copy and paste inside one window', () => {
    const source = editorWith(SPACER);
    const { view } = source.editor;
    source.editor.commands.selectAll();
    const slice = view.state.selection.content();
    const dom = document.createElement('div');
    dom.appendChild(
      clipboardSerializerWithToken(view.state.schema).serializeFragment(slice.content),
    );
    dom.firstElementChild?.setAttribute('data-pm-slice', `${slice.openStart} ${slice.openEnd} []`);
    const target = editorWith('Other.\n');
    target.editor.commands.focus('end');
    target.editor.view.pasteHTML(dom.innerHTML);
    expect(target.getMarkdown()).toBe('Other.\n\nPara.\n\n&nbsp;\n\nEnd.');
  });
});

describe('an edit inside the paragraph lets the spacer go (#468, option i)', () => {
  it('writes a letter typed after the space as text, with its space', () => {
    const editor = editorWith(SPACER);
    editor.editor
      .chain()
      .setTextSelection(spacerAt(editor) + 1)
      .insertContent('x')
      .run();
    expect(editor.getMarkdown()).toBe(`Para.\n\n${NBSP}x\n\nEnd.`);
  });

  it('writes a letter typed before the space as text, with its space', () => {
    const editor = editorWith(SPACER);
    editor.editor.chain().setTextSelection(spacerAt(editor)).insertContent('x').run();
    expect(editor.getMarkdown()).toBe(`Para.\n\nx${NBSP}\n\nEnd.`);
  });

  it('writes nothing for the paragraph once the space is deleted, and an undo brings the spacer back', () => {
    const editor = editorWith(SPACER);
    const at = spacerAt(editor);
    editor.editor
      .chain()
      .setTextSelection({ from: at, to: at + 1 })
      .deleteSelection()
      .run();
    expect(editor.getMarkdown()).toBe('Para.\n\nEnd.');
    editor.editor.commands.undo();
    expect(editor.getMarkdown()).toBe('Para.\n\n&nbsp;\n\nEnd.');
  });

  it('brings the spacer back when the letter typed is undone', () => {
    const editor = editorWith(SPACER);
    editor.editor
      .chain()
      .setTextSelection(spacerAt(editor) + 1)
      .insertContent('x')
      .run();
    editor.editor.commands.undo();
    expect(editor.getMarkdown()).toBe('Para.\n\n&nbsp;\n\nEnd.');
  });

  it('keeps one spacer when Enter splits the paragraph, at either end of the space', () => {
    const atEnd = editorWith(SPACER);
    atEnd.editor
      .chain()
      .setTextSelection(spacerAt(atEnd) + 1)
      .splitBlock()
      .run();
    expect(atEnd.editor.getHTML()).toBe(
      `<p>Para.</p><p ${SPACER_ATTRIBUTE}="">&nbsp;</p><p></p><p>End.</p>`,
    );
    expect(atEnd.getMarkdown()).toBe('Para.\n\n&nbsp;\n\nEnd.');
    const atStart = editorWith(SPACER);
    atStart.editor.chain().setTextSelection(spacerAt(atStart)).splitBlock().run();
    expect(atStart.getMarkdown()).toBe('Para.\n\n&nbsp;\n\nEnd.');
  });
});
