import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * A `br` the file wrote in a line keeps its spelling (#577). See
 * `markdown/br-spelling.ts` for the route.
 */

let instances: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.innerHTML = '';
});

function paste(instance: EditorInstance, html: string, text: string): void {
  const data: Record<string, string> = { 'text/html': html, 'text/plain': text };
  const event = {
    clipboardData: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
      files: [],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = instance.editor;
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

/** The position just after the last character of `text` in the document. */
function endOf(instance: EditorInstance, text: string): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text) + text.length;
    }
  });
  if (found === -1) throw new Error(`no ${text} in the document`);
  return found;
}

describe('an unedited save keeps the spelling of a br (#577)', () => {
  it.each([
    ['br in a paragraph, then a newline', 'one<br>\ntwo'],
    ['br with a slash', 'one<br/>\ntwo'],
    ['br with a space and a slash', 'one<br />\ntwo'],
    ['br in another case', 'one<Br>\ntwo'],
    ['br followed by text on the same line', 'one<br>two'],
    ['br in a list item', '- one<br/>\n  two'],
    ['br in a quote', '> one<br />\n> two'],
    ['a br on a line of its own between two lines (#571)', 'one\n<br>\ntwo'],
  ])('%s', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it('holds a hard break, as before', () => {
    const editor = editorWith('one<br>two');
    const types: string[] = [];
    editor.editor.state.doc.firstChild?.forEach((node) => {
      types.push(node.type.name);
    });
    expect(types).toEqual(['text', 'hardBreak', 'text']);
  });
});

describe('what stays as it was (#577)', () => {
  it('two spaces stay two spaces', () => {
    expect(editorWith('one  \ntwo').getMarkdown()).toBe('one  \ntwo');
  });

  it('a backslash stays a backslash (#584)', () => {
    expect(editorWith('one\\\ntwo').getMarkdown()).toBe('one\\\ntwo');
  });

  it('a br in a table cell is written as the cell rule of #300 writes it', () => {
    const table = '| a | b |\n| --- | --- |\n| one<br>two | x |';
    expect(editorWith(table).getMarkdown()).toBe(table);
    expect(editorWith(table.replace('<br>', '<br/>')).getMarkdown()).toBe(table);
  });
});

describe('a break the file did not write as a tag is two spaces (#577)', () => {
  it('Shift+Enter in the editor', () => {
    const editor = editorWith('one');
    editor.editor.commands.setTextSelection(endOf(editor, 'one'));
    const { view } = editor.editor;
    view.someProp('handleKeyDown', (handler) =>
      handler(view, new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true })),
    );
    editor.editor.commands.insertContent('two');
    expect(editor.getMarkdown()).toBe('one  \ntwo');
  });

  it('a rich paste of a br', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, '<p>one<br>two</p>', 'one\ntwo');
    expect(editor.getMarkdown()).toBe('one  \ntwostart');
  });

  it('a page that spells the attribute (#447)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, '<p>one<br data-br-spelling="br/">two</p>', 'one\ntwo');
    expect(editor.getMarkdown()).toBe('one  \ntwostart');
  });
});

describe('an edit beside a kept br (#577)', () => {
  it('typing at the end of the second line keeps the br', () => {
    const editor = editorWith('one<br>\ntwo');
    editor.editor.chain().setTextSelection(endOf(editor, 'two')).insertContent(' more').run();
    expect(editor.getMarkdown()).toBe('one<br>\ntwo more');
  });
});

describe('a block of br tags alone is kept, and drawn as before (#584)', () => {
  it.each([
    ['one br between two paragraphs', 'one\n\n<br>\n\ntwo'],
    ['one br with a slash', 'one\n\n<br />\n\ntwo'],
    ['several lines of them', 'one\n\n<br>\n<br>\n<br>\n\ntwo'],
    ['several lines, the later ones indented', 'one\n\n<br>\n  <br>\n\ntwo'],
    ['next to a heading and a list', '# Head\n\n<br>\n\n- item'],
  ])('%s', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(editorWith(editor.getMarkdown()).getMarkdown()).toBe(markdown);
  });

  it('is drawn as a paragraph of hard breaks, as before', () => {
    const editor = editorWith('one\n\n<br>\n\ntwo');
    const types: string[] = [];
    editor.editor.state.doc.child(1).forEach((node) => {
      types.push(node.type.name);
    });
    expect(types).toEqual(['hardBreak']);
  });

  it('loses the indentation of its first line, recorded under R-C2', () => {
    expect(editorWith('one\n\n  <br>\n  <br>\n\ntwo').getMarkdown()).toBe(
      'one\n\n<br>\n  <br>\n\ntwo',
    );
  });

  it('typing in the paragraph after it keeps it', () => {
    const editor = editorWith('one\n\n<br>\n\ntwo');
    editor.editor.chain().setTextSelection(endOf(editor, 'two')).insertContent(' more').run();
    expect(editor.getMarkdown()).toBe('one\n\n<br>\n\ntwo more');
  });
});

describe('a trailing backslash keeps its spelling (#584)', () => {
  it.each([
    ['in a paragraph', 'one\\\ntwo'],
    ['in a list item', '- one\\\n  two'],
    ['in a quote', '> one\\\n> two'],
  ])('%s', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });

  it('a backslash ending a paragraph is no break, and keeps the escape it had on main', () => {
    // Known exception: an escape the file did not have; unchanged by #584.
    expect(editorWith('end\\').getMarkdown()).toBe('end\\\\');
  });

  it('a page that spells a backslash on the attribute pastes two spaces (#447)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, '<p>one<br data-br-spelling="\\">two</p>', 'one\ntwo');
    expect(editor.getMarkdown()).toBe('one  \ntwostart');
  });
});
