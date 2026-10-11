import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * An ordered list numbered with one number throughout keeps it (#569). See
 * `LIST_NUMBERING_ATTRIBUTE` in `markdown/list-marker.ts` for the route.
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
    if (found === -1 && node.isText && node.text === text) found = pos + text.length;
  });
  if (found === -1) throw new Error(`no ${text} in the document`);
  return found;
}

describe('an unedited save keeps the numbering style of an ordered list (#569)', () => {
  it.each([
    ['one number throughout', '1. a\n1. b\n1. c'],
    ['one number throughout, from another start', '3. a\n3. b\n3. c'],
    ['one number with the parenthesis delimiter', '1) a\n1) b'],
    ['counted up, as before', '1. a\n2. b\n3. c'],
    ['counted up from another start, as before', '4. a\n5. b'],
    ['nested lists, each with its own style', '1. a\n   1. x\n   1. y\n2. b\n   1. z\n   2. w'],
  ])('%s', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });

  it('is shown counted up on screen, as before', () => {
    const editor = editorWith('1. a\n1. b\n1. c');
    const list = editor.editor.view.dom.querySelector('ol');
    // The editor draws the list from its start; the browser counts the items.
    expect(list?.getAttribute('start') ?? '1').toBe('1');
    expect(list?.children).toHaveLength(3);
  });
});

describe('a list numbered some other way is written counting up (#569)', () => {
  it('a skipped number', () => {
    // Known exception: an ordered list numbered neither with one number nor counting up.
    expect(editorWith('1. a\n3. b').getMarkdown()).toBe('1. a\n2. b');
  });
});

describe('an item added with Enter takes the style of its list (#569)', () => {
  it.each([
    ['one number throughout', '1. a\n1. b\n1. c', '1. a\n1. b\n1. c\n1. d'],
    ['counted up', '1. a\n2. b\n3. c', '1. a\n2. b\n3. c\n4. d'],
  ])('%s', (_label, markdown, written) => {
    const editor = editorWith(markdown);
    editor.editor.chain().setTextSelection(endOf(editor, 'c')).splitListItem('listItem').run();
    editor.editor.commands.insertContent('d');
    expect(editor.getMarkdown()).toBe(written);
  });
});

describe('a list split by a paragraph still continues on screen (R-C1, D1)', () => {
  it.each([
    // As before #569: the second list starts where the first left off.
    ['counted up', '1. a\n2. b\n3. c\n4. d\n5. e', '1. a\n2. b\n\nc\n\n3. d\n4. e'],
    // The second list starts at 3 as well, and keeps the one number it had.
    ['one number throughout', '1. a\n1. b\n1. c\n1. d\n1. e', '1. a\n1. b\n\nc\n\n3. d\n3. e'],
  ])('%s', (_label, markdown, written) => {
    const editor = editorWith(markdown);
    editor.editor.chain().setTextSelection(endOf(editor, 'c')).liftListItem('listItem').run();
    const lists = editor.editor.view.dom.querySelectorAll('ol');
    expect(lists).toHaveLength(2);
    expect(lists[1]?.getAttribute('start')).toBe('3');
    expect(editor.getMarkdown()).toBe(written);
  });
});

describe('a list that did not come from the file is counted up (#569)', () => {
  it('a list made in the editor', () => {
    const editor = editorWith('a\n\nb');
    editor.editor
      .chain()
      .setTextSelection({ from: 1, to: editor.editor.state.doc.content.size - 1 })
      .toggleOrderedList()
      .run();
    expect(editor.getMarkdown()).toBe('1. a\n2. b');
  });

  it('a rich paste', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, '<ol><li>a</li><li>b</li></ol>', 'a\nb');
    expect(editor.getMarkdown()).toContain('1. a\n2. b');
  });

  it('a page that spells the attribute (#447)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, '<ol data-list-numbering="one"><li>a</li><li>b</li></ol>', 'a\nb');
    expect(editor.getMarkdown()).toContain('1. a\n2. b');
  });
});
