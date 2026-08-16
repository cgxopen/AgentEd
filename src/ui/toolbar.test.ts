import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
import { setupToolbar } from './toolbar';

let instance: EditorInstance | null = null;

function mountEditorWithToolbar(
  markdown: string,
  onLink = vi.fn(),
): {
  editor: EditorInstance;
  onLink: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  setupToolbar(instance.editor, { onLink });
  return { editor: instance, onLink };
}

function toolbarButton(title: string): HTMLButtonElement {
  const match = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#floating-toolbar button'),
  ).find((b) => b.title === title);
  if (!match) throw new Error(`no toolbar button titled "${title}"`);
  return match;
}

function select(editorInstance: EditorInstance, text: string): void {
  let from = -1;
  editorInstance.editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) from = pos + node.text.indexOf(text);
  });
  if (from < 0) throw new Error(`text not found: ${text}`);
  editorInstance.editor.commands.setTextSelection({ from, to: from + text.length });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.getElementById('floating-toolbar')?.remove();
});

describe('floating toolbar — the link button (#25)', () => {
  it('ships alongside the formatting buttons', () => {
    mountEditorWithToolbar('the docs');
    expect(() => toolbarButton('Link (Ctrl+K)')).not.toThrow();
    expect(() => toolbarButton('Bold (Ctrl+B)')).not.toThrow();
  });

  it('opens the dialog rather than acting on the editor itself', () => {
    const { editor, onLink } = mountEditorWithToolbar('the docs');
    select(editor, 'the docs');

    toolbarButton('Link (Ctrl+K)').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );

    expect(onLink).toHaveBeenCalledTimes(1);
    // The button asks; the dialog decides. Nothing changes until it does.
    expect(editor.getMarkdown()).toBe('the docs');
  });

  it('marks itself active when the caret sits in a link', () => {
    const { editor } = mountEditorWithToolbar('[docs](https://example.com)');
    select(editor, 'docs');
    editor.editor.commands.focus();

    expect(toolbarButton('Link (Ctrl+K)').classList.contains('active')).toBe(true);
  });
});
