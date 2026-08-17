import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

/**
 * #37: a bare URL stays text in the editor too, not only in the parser.
 *
 * #21 stopped the *parser* from autolinking, but the Link extension went on
 * linkifying live, one boundary character after the URL was typed — the same
 * `[https://x](https://x)` artifact in the saved file, merely delayed. With the
 * link button and Ctrl+K now offering an explicit route (#25), the trade is
 * complete: the editor never invents link syntax.
 */
let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** Type at the caret, the way the user would. */
function typeText(editorInstance: EditorInstance, text: string): void {
  editorInstance.editor.commands.insertContent(text);
}

afterEach(() => {
  instance?.destroy();
  instance = null;
});

describe('the editor does not invent links', () => {
  it('leaves a typed URL as text once a space follows it', () => {
    const editor = editorWith('');
    typeText(editor, 'https://example.com ');

    expect(editor.editor.getHTML()).not.toContain('<a ');
    expect(editor.getMarkdown()).not.toContain('](');
  });

  it('leaves a typed URL as text at the end of a sentence', () => {
    const editor = editorWith('');
    typeText(editor, 'see https://example.com for details');

    expect(editor.editor.getHTML()).not.toContain('<a ');
  });

  it('leaves a typed URL as text when Enter follows it', () => {
    const editor = editorWith('');
    typeText(editor, 'https://example.com');
    editor.editor.commands.enter();

    expect(editor.editor.getHTML()).not.toContain('<a ');
  });

  it('leaves a typed email address as text', () => {
    const editor = editorWith('');
    typeText(editor, 'hi@example.com ');

    expect(editor.editor.getHTML()).not.toContain('<a ');
  });

  it('saves a document mentioning a URL without adding link syntax (R-C2)', () => {
    const editor = editorWith('');
    typeText(editor, 'read https://example.com twice');

    expect(editor.getMarkdown()).toBe('read https://example.com twice');
  });

  // The behavioural tests above are the ones that matter, but they would pass
  // if some future refactor silently swapped the mechanism; this fails the
  // moment the option comes back on.
  it('keeps the Link extension configured with autolink off', () => {
    const editor = editorWith('');
    const link = editor.editor.extensionManager.extensions.find((e) => e.name === 'link');
    expect(link?.options.autolink).toBe(false);
    expect(link?.options.linkOnPaste).toBe(false);
  });
});

describe('links that were written explicitly still work', () => {
  it('keeps a link opened from a file, byte for byte (R-C2)', () => {
    const markdown = 'read [the docs](https://example.com) now';
    const editor = editorWith(markdown);

    expect(editor.editor.getHTML()).toContain('href="https://example.com"');
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it('keeps an explicit link whose text is its own address', () => {
    const markdown = '[https://example.com](https://example.com)';
    const editor = editorWith(markdown);

    expect(editor.getMarkdown()).toBe(markdown);
  });
});
