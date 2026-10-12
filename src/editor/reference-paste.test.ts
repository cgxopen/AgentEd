import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

/**
 * A pasted reference link keeps its spelling only where its label names, in
 * the document it lands in, a definition with the address the link holds
 * (#570, review 5491435367 on #589).
 *
 * Measured on `185b798`: the link `[aa][docs]`, defined as `https://a.example`,
 * copied inside one window into a document defining `[docs]` as
 * `https://b.example`, was saved as `[aa][docs]` and reopened at the second
 * address, since an internal paste keeps the spelling the pipeline stamped. On
 * `1793896` it was written with its own address. Every paste route is asked.
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

/** Fire a paste carrying the given clipboard contents; true when the handler took it. */
function paste(editor: EditorInstance, clipboard: { text?: string; html?: string }): boolean {
  const data: Record<string, string> = {};
  if (clipboard.text !== undefined) data['text/plain'] = clipboard.text;
  if (clipboard.html !== undefined) data['text/html'] = clipboard.html;
  const event = {
    clipboardData: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
      files: [],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = editor.editor;
  return Boolean(
    view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content())),
  );
}

/** Copy the text `text` of `editor` as this window puts it on the clipboard. */
function copy(editor: EditorInstance, text: string): string {
  let from = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text?.includes(text))
      from = pos + node.text.indexOf(text);
  });
  editor.editor.commands.setTextSelection({ from, to: from + text.length });
  const { view, state } = editor.editor;
  return view.serializeForClipboard(state.selection.content()).dom.innerHTML;
}

/** Paste `html` at the end of the first paragraph of `editor`, as the app pastes a copy. */
function pasteCopy(editor: EditorInstance, html: string, text: string): void {
  const end = editor.editor.state.doc.firstChild?.nodeSize ?? 2;
  editor.editor.commands.setTextSelection(end - 1);
  if (!paste(editor, { text, html })) editor.editor.view.pasteHTML(html);
}

const A = '\n\n[docs]: https://a.example\n';
const B = '\n\n[docs]: https://b.example\n';

describe('a reference link pasted (#570, review of #589)', () => {
  it('inside one document keeps its spelling: the label names its own definition', () => {
    const editor = editorWith(`See [aa][docs].${A}`);
    pasteCopy(editor, copy(editor, 'aa'), 'aa');
    expect(editor.getMarkdown()).toBe('See [aa][docs].[aa][docs]\n\n[docs]: https://a.example');
  });

  it('into a document defining the label to another address is written with its own', () => {
    const html = copy(editorWith(`See [aa][docs].${A}`), 'aa');
    const target = editorWith(`Here.${B}`);
    pasteCopy(target, html, 'aa');
    expect(target.getMarkdown()).toBe('Here.[aa](https://a.example)\n\n[docs]: https://b.example');
  });

  it('into a document defining the label to the same address keeps its spelling', () => {
    const html = copy(editorWith(`See [aa][docs].${A}`), 'aa');
    const target = editorWith(`Here.${A}`);
    pasteCopy(target, html, 'aa');
    expect(target.getMarkdown()).toBe('Here.[aa][docs]\n\n[docs]: https://a.example');
  });

  it('into a document with no such definition is written with its own address', () => {
    const html = copy(editorWith(`See [aa][docs].${A}`), 'aa');
    const target = editorWith('Here.');
    pasteCopy(target, html, 'aa');
    expect(target.getMarkdown()).toBe('Here.[aa](https://a.example)');
  });

  it('from another window is written with its own address', () => {
    const html = copy(editorWith(`See [aa][docs].${A}`), 'aa').replace(
      /data-agented-copy="[0-9a-f]+"/,
      'data-agented-copy="0000"',
    );
    const target = editorWith(`Here.${B}`);
    pasteCopy(target, html, 'aa');
    expect(target.getMarkdown()).toBe('Here.[aa](https://a.example)\n\n[docs]: https://b.example');
  });

  it('as plain text with its definition, under a definition of the label above, is written with its own', () => {
    // The definition already in the document comes first, so it is the one the
    // label names; the pasted one is kept as the line it is.
    const target = editorWith('[docs]: https://b.example\n\nHere.\n');
    target.editor.commands.setTextSelection(target.editor.state.doc.content.size - 1);
    paste(target, { text: 'See [aa][docs].\n\n[docs]: https://a.example' });
    expect(target.getMarkdown()).toBe(
      '[docs]: https://b.example\n\nHere.See [aa](https://a.example).\n\n[docs]: https://a.example',
    );
  });

  it('as plain text with its definition, into a document without one, keeps its spelling', () => {
    const target = editorWith('');
    paste(target, { text: 'See [aa][docs].\n\n[docs]: https://a.example' });
    expect(target.getMarkdown()).toBe('See [aa][docs].\n\n[docs]: https://a.example');
  });

  it('a link left in place still follows its definition (E4)', () => {
    const editor = editorWith(`See [aa][docs].${A}`);
    let at = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (at === -1 && node.isText && node.text?.includes('a.example'))
        at = pos + node.text.indexOf('a.example');
    });
    editor.editor.view.dispatch(editor.editor.state.tr.insertText('c', at, at + 1));
    expect(editor.getMarkdown()).toBe('See [aa][docs].\n\n[docs]: https://c.example');
  });
});
