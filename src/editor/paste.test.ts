import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanPastedHtml, isInternalPaste, type PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * R-C13 at the level the user meets it: a paste event reaching a real
 * editor. The event is synthetic — happy-dom has no clipboard — but it is
 * dispatched through `view.someProp`, so the handler that answers it is
 * chosen exactly as it would be in the app, image handler included.
 */
let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const element = document.createElement('div');
  document.body.appendChild(element);
  instance = createEditor(element);
  instance.setMarkdown(markdown);
  return instance;
}

interface Clipboard {
  text?: string;
  html?: string;
}

/** Fire a paste carrying the given clipboard contents; true when handled. */
function paste(editorInstance: EditorInstance, clipboard: Clipboard): boolean {
  const data: Record<string, string> = {};
  if (clipboard.text !== undefined) data['text/plain'] = clipboard.text;
  if (clipboard.html !== undefined) data['text/html'] = clipboard.html;
  const event = {
    clipboardData: {
      // Other extensions probe types of their own (the code block asks for
      // 'vscode-editor-data'), so unknown types must come back empty.
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
      files: [],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = editorInstance.editor;
  return Boolean(
    view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content())),
  );
}

/** Put the caret at the end of the given text. */
function caretAfter(editorInstance: EditorInstance, text: string): void {
  let position = -1;
  editorInstance.editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) {
      position = pos + (node.text.indexOf(text) + text.length);
    }
  });
  if (position < 0) throw new Error(`text not found: ${text}`);
  editorInstance.editor.commands.setTextSelection(position);
}

function storageOf(editorInstance: EditorInstance): PredictablePasteStorage {
  return editorInstance.editor.storage.predictablePaste as PredictablePasteStorage;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
});

describe('predictable paste', () => {
  describe('plain text goes in as it stands', () => {
    it('does not read markdown emphasis in pasted plain text', () => {
      const editor = editorWith('start');
      caretAfter(editor, 'start');
      expect(paste(editor, { text: ' **not bold** and *not italic*' })).toBe(true);
      expect(editor.editor.getHTML()).not.toContain('<strong>');
      expect(editor.editor.getHTML()).not.toContain('<em>');
      expect(editor.editor.getText()).toContain('**not bold** and *not italic*');
    });

    it('does not read a pasted backtick span as inline code', () => {
      const editor = editorWith('start');
      caretAfter(editor, 'start');
      paste(editor, { text: ' `npm test`' });
      expect(editor.editor.getHTML()).not.toContain('<code>');
    });

    it('merges a single pasted line into the sentence around the caret', () => {
      const editor = editorWith('one three');
      caretAfter(editor, 'one');
      paste(editor, { text: ' two' });
      expect(editor.getMarkdown()).toBe('one two three');
    });

    it('splits multi-line plain text into paragraphs', () => {
      const editor = editorWith('');
      paste(editor, { text: 'first\nsecond' });
      expect(editor.getMarkdown()).toBe('first\n\nsecond');
    });

    it('keeps newlines as content when pasting into a fenced block', () => {
      const editor = editorWith('```\nkeep\n```');
      caretAfter(editor, 'keep');
      paste(editor, { text: '\nsecond line' });
      expect(editor.getMarkdown()).toContain('keep\nsecond line');
    });

    it('ignores a paste that carries nothing at all', () => {
      const editor = editorWith('untouched');
      expect(paste(editor, {})).toBe(false);
      expect(editor.getMarkdown()).toBe('untouched');
    });
  });

  describe('URLs are not auto-converted (R-C13)', () => {
    it('leaves a bare pasted URL as text', () => {
      const editor = editorWith('');
      paste(editor, { text: 'https://example.com' });
      expect(editor.editor.getHTML()).not.toContain('<a ');
      expect(editor.getMarkdown()).toBe('https://example.com');
    });

    it('leaves a URL inside a pasted sentence as text', () => {
      const editor = editorWith('');
      paste(editor, { text: 'see https://example.com for details' });
      expect(editor.editor.getHTML()).not.toContain('<a ');
    });

    it('leaves a URL pasted into an existing sentence as text', () => {
      const editor = editorWith('link:');
      caretAfter(editor, 'link:');
      paste(editor, { text: ' https://example.com' });
      expect(editor.editor.getHTML()).not.toContain('<a ');
    });
  });

  describe('rich HTML converts to clean markdown', () => {
    it('drops styling markup a browser adds around the text', () => {
      const editor = editorWith('');
      paste(editor, {
        text: 'Heading\nbold text',
        html: '<div style="font-family:Arial"><h2 class="x" id="y">Heading</h2><p><span style="font-weight:700"><b>bold</b> text</span></p></div>',
      });
      const markdown = editor.getMarkdown();
      expect(markdown).toContain('## Heading');
      expect(markdown).toContain('**bold** text');
      expect(markdown).not.toContain('<span');
      expect(markdown).not.toContain('style=');
      expect(markdown).not.toContain('class=');
    });

    it('keeps a real link as a markdown link, with no stray fragments', () => {
      const editor = editorWith('');
      paste(editor, {
        text: 'the docs',
        html: '<p>read <a href="https://example.com" target="_blank" rel="nofollow">the docs</a> first</p>',
      });
      const markdown = editor.getMarkdown();
      expect(markdown).toBe('read [the docs](https://example.com) first');
      expect(markdown).not.toContain('rel=');
      expect(markdown).not.toContain('target=');
    });

    it('converts a pasted list into real list structure', () => {
      const editor = editorWith('');
      // Marker width belongs to the serializer, not to paste: assert the
      // structure that arrived, not how turndown spells it.
      paste(editor, { text: 'one two', html: '<ul><li>one</li><li>two</li></ul>' });
      expect(editor.editor.getHTML()).toContain('<ul>');
      expect(editor.getMarkdown()).toMatch(/-\s+one/);
      expect(editor.getMarkdown()).toMatch(/-\s+two/);
    });

    it('strips a script the clipboard HTML carries', () => {
      const editor = editorWith('');
      // DOMPurify keeps the inert text of a stripped element; what must not
      // survive is the element itself.
      paste(editor, { text: 'safe', html: '<p>safe<script>alert(1)</script></p>' });
      expect(editor.editor.getHTML()).not.toContain('<script');
      expect(editor.getMarkdown()).not.toContain('<script');
    });

    it('does not linkify a URL that the HTML leaves as text', () => {
      const editor = editorWith('');
      paste(editor, { text: 'https://example.com', html: '<p>https://example.com</p>' });
      expect(editor.editor.getHTML()).not.toContain('<a ');
    });
  });

  describe('Ctrl+Shift+V forces plain text', () => {
    it('ignores the clipboard HTML when a plain paste was just requested', () => {
      const editor = editorWith('');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, { text: '# Heading', html: '<h1>Heading</h1>' });
      expect(editor.getMarkdown()).toBe('\\# Heading');
      expect(editor.editor.getHTML()).not.toContain('<h1>');
    });

    it('arms only the paste that follows it', () => {
      const editor = editorWith('');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, { text: 'first', html: '<p>first</p>' });
      expect(storageOf(editor).plainPasteRequestedAt).toBe(0);

      editor.setMarkdown('');
      paste(editor, { text: 'second', html: '<h1>second</h1>' });
      expect(editor.getMarkdown()).toContain('# second');
    });

    it('lets a stale request expire instead of hijacking a later paste', () => {
      const editor = editorWith('');
      storageOf(editor).plainPasteRequestedAt = Date.now() - 60_000;
      paste(editor, { text: 'Heading', html: '<h1>Heading</h1>' });
      expect(editor.getMarkdown()).toBe('# Heading');
    });
  });

  describe('a copy from this editor is left to ProseMirror', () => {
    it('recognises its own clipboard markup', () => {
      expect(isInternalPaste('<p data-pm-slice="1 1 []">text</p>')).toBe(true);
      expect(isInternalPaste('<p>text</p>')).toBe(false);
    });

    it('does not handle the paste itself', () => {
      const editor = editorWith('');
      expect(paste(editor, { text: 'text', html: '<p data-pm-slice="1 1 []">text</p>' })).toBe(
        false,
      );
    });
  });

  describe('cleanPastedHtml', () => {
    it('rewrites markup through the markdown the file would hold', () => {
      expect(cleanPastedHtml('<p><b>x</b></p>')).toContain('<strong>x</strong>');
    });

    it('leaves nothing of an unknown wrapper element', () => {
      const cleaned = cleanPastedHtml('<article data-id="9"><p>text</p></article>');
      expect(cleaned).not.toContain('article');
      expect(cleaned).not.toContain('data-id');
      expect(cleaned).toContain('text');
    });
  });
});
