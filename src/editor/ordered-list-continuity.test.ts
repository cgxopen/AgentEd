import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

/**
 * Defect D1 at the level it actually happens: a real editor, a real split.
 * The markdown-only round-trip lives in markdown/roundtrip.test.ts — these
 * cases cover what the *editing* path does to the numbering.
 */
let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const element = document.createElement('div');
  document.body.appendChild(element);
  instance = createEditor(element);
  instance.setMarkdown(markdown);
  return instance;
}

/** Position just after the given text, as a caret would sit at its end. */
function endOf(editorInstance: EditorInstance, text: string): number {
  let position = -1;
  editorInstance.editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) position = pos + node.nodeSize;
  });
  if (position < 0) throw new Error(`text not found in document: ${text}`);
  return position;
}

/** What pressing Enter twice at the end of an item does: split, then lift out. */
function breakOutAfter(editorInstance: EditorInstance, text: string): void {
  editorInstance.editor.commands.setTextSelection(endOf(editorInstance, text));
  editorInstance.editor.commands.splitListItem('listItem');
  editorInstance.editor.commands.liftListItem('listItem');
}

afterEach(() => {
  instance?.destroy();
  instance = null;
});

describe('ordered list continuity', () => {
  it('continues the numbering when a paragraph splits a list', () => {
    const editor = editorWith('1. one\n2. two\n3. three');
    breakOutAfter(editor, 'two');
    // Without the plugin the tail is a fresh list and serializes "1. three".
    expect(editor.getMarkdown()).toBe('1. one\n2. two\n\n3. three');
  });

  it('counts from the list rendered above, not from the pre-split document', () => {
    // The item lifted out still exists in the previous document; deriving the
    // number from there would produce an off-by-one (4 instead of 3 here).
    const editor = editorWith('1. one\n2. two\n3. three\n4. four');
    breakOutAfter(editor, 'two');
    expect(editor.getMarkdown()).toBe('1. one\n2. two\n\n3. three\n4. four');
  });

  it('continues from a list that itself starts past 1', () => {
    const editor = editorWith('7. seven\n8. eight\n9. nine');
    breakOutAfter(editor, 'eight');
    expect(editor.getMarkdown()).toBe('7. seven\n8. eight\n\n9. nine');
  });

  it('leaves a document alone when nothing is edited', () => {
    const editor = editorWith('1. one\n2. two\n\npara\n\n3. three\n4. four');
    expect(editor.getMarkdown()).toBe('1. one\n2. two\n\npara\n\n3. three\n4. four');
  });

  it('keeps two deliberately separate lists starting at 1 (R-C2)', () => {
    const editor = editorWith('1. one\n2. two\n\npara\n\n1. alpha\n2. beta');
    editor.editor.commands.setTextSelection(endOf(editor, 'para'));
    editor.editor.commands.insertContent('!');
    expect(editor.getMarkdown()).toBe('1. one\n2. two\n\npara!\n\n1. alpha\n2. beta');
  });

  it('does not renumber a list typed after an unrelated paragraph', () => {
    const editor = editorWith('A paragraph.');
    editor.editor.commands.setTextSelection(endOf(editor, 'A paragraph.'));
    editor.editor.commands.insertContent('<ol><li><p>fresh</p></li></ol>');
    expect(editor.getMarkdown()).toContain('1. fresh');
  });

  it('leaves the tail at 1 when no ordered list is rendered above it', () => {
    // Breaking out of the *first* item leaves nothing numbered above the
    // tail; continuing from an invisible list would be a guess.
    const editor = editorWith('1. one\n2. two');
    editor.editor.commands.setTextSelection(1);
    editor.editor.commands.liftListItem('listItem');
    expect(editor.getMarkdown()).toContain('1. two');
  });

  it('does not renumber a list whose leading item is deleted', () => {
    // Deleting the first item maps the list back into itself past item one —
    // the same shape a split produces. The list already existed, so it must
    // keep its own numbering rather than continue the list above it.
    const editor = editorWith('1. one\n2. two\n\npara\n\n1. alpha\n2. beta\n3. gamma');
    let range: { from: number; to: number } | null = null;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'listItem' && node.textContent === 'alpha') {
        range = { from: pos, to: pos + node.nodeSize };
      }
    });
    if (!range) throw new Error('list item not found');
    editor.editor.commands.deleteRange(range);
    expect(editor.getMarkdown()).toBe('1. one\n2. two\n\npara\n\n1. beta\n2. gamma');
  });

  it('does not renumber a bullet list split by a paragraph', () => {
    const editor = editorWith('- one\n- two\n- three');
    breakOutAfter(editor, 'two');
    expect(editor.getMarkdown()).toBe('- one\n- two\n\n- three');
  });
});
