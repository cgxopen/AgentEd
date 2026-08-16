import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanPastedHtml,
  isInternalPaste,
  isPlainPasteShortcut,
  type PredictablePasteStorage,
} from './paste';
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
  // TipTap builds extension storage once per extension object, and the
  // extension list is a module singleton — so every editor in this process
  // shares it. One editor per window in the app, but in a test file a pending
  // plain-paste request would leak into the next test.
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
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

/** Select the given text inside the document. */
function select(editorInstance: EditorInstance, text: string): void {
  let from = -1;
  editorInstance.editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) {
      from = pos + node.text.indexOf(text);
    }
  });
  if (from < 0) throw new Error(`text not found: ${text}`);
  editorInstance.editor.commands.setTextSelection({ from, to: from + text.length });
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

/**
 * Press Ctrl+Shift+V the way a browser reports it: `key` shifted to uppercase
 * "V", `code` naming the physical key, and no `keyCode` — the deprecated field
 * the previous binding secretly depended on.
 */
function pressPlainPasteShortcut(target: EventTarget, overrides: KeyboardEventInit = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'V',
      code: 'KeyV',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
      ...overrides,
    }),
  );
}

afterEach(() => {
  instance?.destroy();
  instance = null;
});

describe('predictable paste', () => {
  describe('plain text is read as markdown', () => {
    it('reads emphasis in pasted plain text', () => {
      const editor = editorWith('start');
      caretAfter(editor, 'start');
      expect(paste(editor, { text: ' **bold** and *italic*' })).toBe(true);
      expect(editor.editor.getHTML()).toContain('<strong>');
      expect(editor.editor.getHTML()).toContain('<em>');
    });

    it('reads a pasted backtick span as inline code', () => {
      const editor = editorWith('start');
      caretAfter(editor, 'start');
      paste(editor, { text: ' `npm test`' });
      expect(editor.editor.getHTML()).toContain('<code>');
    });

    it('reads a pasted heading as a heading', () => {
      const editor = editorWith('');
      paste(editor, { text: '# Heading' });
      expect(editor.editor.getHTML()).toContain('<h1>');
      expect(editor.getMarkdown()).toBe('# Heading');
    });

    it('reads a block copied out of an AI chat as structure, not source', () => {
      const editor = editorWith('');
      paste(editor, { text: '## Steps\n\n1. first\n2. second\n\nSee `code` here.' });
      const html = editor.editor.getHTML();
      expect(html).toContain('<h2>');
      expect(html).toContain('<ol>');
      expect(html).toContain('<code>');
      expect(editor.getMarkdown()).not.toContain('\\#');
    });

    it('reads a pasted fenced block as a code block', () => {
      const editor = editorWith('');
      paste(editor, { text: '```js\nconst a = 1;\n```' });
      expect(editor.editor.getHTML()).toContain('<pre');
      expect(editor.getMarkdown()).toContain('const a = 1;');
    });

    it('keeps four leading spaces as text rather than reading a code block', () => {
      const editor = editorWith('');
      paste(editor, { text: '    const x = 1;' });
      expect(editor.editor.getHTML()).not.toContain('<pre');
      expect(editor.editor.getText()).toContain('const x = 1;');
    });

    it('merges a single pasted line into the sentence around the caret', () => {
      const editor = editorWith('one three');
      caretAfter(editor, 'one');
      paste(editor, { text: ' two' });
      expect(editor.getMarkdown()).toBe('one two three');
    });

    it('keeps pasted lines on separate lines', () => {
      // Markdown would reflow a single newline into a space, losing the only
      // structure a plain-text paste carries; pasted text reads it as a line
      // break instead, so two copied lines stay two lines.
      const editor = editorWith('');
      paste(editor, { text: 'first\nsecond' });
      expect(editor.editor.getHTML()).toContain('<br');
      expect(editor.getMarkdown()).toContain('first');
      expect(editor.getMarkdown()).toContain('second');
      expect(editor.getMarkdown()).not.toBe('first second');
    });

    it('keeps a blank line between pasted paragraphs', () => {
      const editor = editorWith('');
      paste(editor, { text: 'first\n\nsecond' });
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

  describe('Ctrl+Shift+V inserts the characters literally', () => {
    it('does not read markdown emphasis in the pasted text', () => {
      const editor = editorWith('start');
      caretAfter(editor, 'start');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      expect(paste(editor, { text: ' **not bold** and *not italic*' })).toBe(true);
      expect(editor.editor.getHTML()).not.toContain('<strong>');
      expect(editor.editor.getHTML()).not.toContain('<em>');
      expect(editor.editor.getText()).toContain('**not bold** and *not italic*');
    });

    it('does not read a backtick span as inline code', () => {
      const editor = editorWith('start');
      caretAfter(editor, 'start');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, { text: ' `npm test`' });
      expect(editor.editor.getHTML()).not.toContain('<code>');
    });

    it('splits multi-line text into paragraphs', () => {
      const editor = editorWith('');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, { text: 'first\nsecond' });
      expect(editor.getMarkdown()).toBe('first\n\nsecond');
    });

    it('escapes the syntax it inserted, so the literal text round-trips', () => {
      const editor = editorWith('');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, { text: '# Heading' });
      expect(editor.editor.getHTML()).not.toContain('<h1>');
      expect(editor.getMarkdown()).toBe('\\# Heading');
    });

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

    it('keeps newlines as content when forced inside a fenced block', () => {
      const editor = editorWith('```\nkeep\n```');
      caretAfter(editor, 'keep');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, { text: '\nsecond line' });
      expect(editor.getMarkdown()).toContain('keep\nsecond line');
    });
  });

  // #32: the branch above was correct all along; what failed in the desktop
  // build was the arming — the keystroke never set the flag, so every paste
  // took the ordinary path. These cover the keystroke itself.
  describe('Ctrl+Shift+V arms the plain branch', () => {
    describe('isPlainPasteShortcut', () => {
      it('matches the event a browser reports for Ctrl+Shift+V', () => {
        const event = new KeyboardEvent('keydown', {
          key: 'V',
          code: 'KeyV',
          ctrlKey: true,
          shiftKey: true,
        });
        expect(isPlainPasteShortcut(event)).toBe(true);
      });

      it('matches Cmd+Shift+V on macOS', () => {
        const event = new KeyboardEvent('keydown', {
          key: 'V',
          code: 'KeyV',
          metaKey: true,
          shiftKey: true,
        });
        expect(isPlainPasteShortcut(event)).toBe(true);
      });

      it('matches on the physical key even when the layout reports another character', () => {
        const event = new KeyboardEvent('keydown', {
          key: 'ẞ',
          code: 'KeyV',
          ctrlKey: true,
          shiftKey: true,
        });
        expect(isPlainPasteShortcut(event)).toBe(true);
      });

      it('matches on the key when the event carries no code', () => {
        const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true });
        expect(isPlainPasteShortcut(event)).toBe(true);
      });

      it.each([
        ['plain Ctrl+V', { key: 'v', code: 'KeyV', ctrlKey: true }],
        ['Shift+V with no modifier', { key: 'V', code: 'KeyV', shiftKey: true }],
        ['Ctrl+Shift+C', { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true }],
        [
          'Ctrl+Alt+Shift+V',
          { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true, altKey: true },
        ],
      ])('does not match %s', (_label, init) => {
        expect(isPlainPasteShortcut(new KeyboardEvent('keydown', init))).toBe(false);
      });
    });

    it('arms the flag from a real keydown on the editor', () => {
      const editor = editorWith('');
      expect(storageOf(editor).plainPasteRequestedAt).toBe(0);
      pressPlainPasteShortcut(editor.editor.view.dom);
      expect(storageOf(editor).plainPasteRequestedAt).toBeGreaterThan(0);
    });

    it('ignores the shortcut pressed outside the editor', () => {
      const editor = editorWith('');
      const elsewhere = document.createElement('input');
      document.body.appendChild(elsewhere);
      pressPlainPasteShortcut(elsewhere);
      expect(storageOf(editor).plainPasteRequestedAt).toBe(0);
      elsewhere.remove();
    });

    it('keeps a browser-copied URL as text, HTML and all', () => {
      // What the owner reported: a URL copied from a browser carries both
      // text/plain and an <a> in text/html.
      const editor = editorWith('');
      pressPlainPasteShortcut(editor.editor.view.dom);
      paste(editor, {
        text: 'https://example.com',
        html: '<a href="https://example.com" rel="nofollow noreferrer">https://example.com</a>',
      });
      expect(editor.editor.getHTML()).not.toContain('<a ');
      expect(editor.getMarkdown()).toBe('https://example.com');
    });

    it('still links that same clipboard on an ordinary paste', () => {
      // The other half of the acceptance criteria: the rich-HTML branch is
      // correct and must keep the link the copied content actually had.
      const editor = editorWith('');
      paste(editor, {
        text: 'https://example.com',
        html: '<a href="https://example.com" rel="nofollow noreferrer">https://example.com</a>',
      });
      expect(editor.getMarkdown()).toBe('[https://example.com](https://example.com)');
    });

    it('does not arm an ordinary Ctrl+V', () => {
      const editor = editorWith('');
      pressPlainPasteShortcut(editor.editor.view.dom, { shiftKey: false, key: 'v' });
      paste(editor, { text: '# Heading', html: '<h1>Heading</h1>' });
      expect(editor.getMarkdown()).toBe('# Heading');
    });
  });

  // #25: the sentence first, the address after — the way Word, Google Docs and
  // GitHub's editor all behave. The opposite of what R-C13 forbids: there a
  // pasted URL links *itself*; here the user selected the text and supplied
  // the destination.
  describe('a URL pasted over a selection links it', () => {
    it('makes the selection the link text', () => {
      const editor = editorWith('read the docs now');
      select(editor, 'the docs');
      expect(paste(editor, { text: 'https://example.com' })).toBe(true);

      expect(editor.getMarkdown()).toBe('read [the docs](https://example.com) now');
    });

    it('round-trips what it created, byte for byte (R-C2)', () => {
      const editor = editorWith('the docs');
      select(editor, 'the docs');
      paste(editor, { text: 'https://example.com' });

      const markdown = editor.getMarkdown();
      editor.setMarkdown(markdown);
      expect(editor.getMarkdown()).toBe(markdown);
    });

    it('links from a clipboard that also carries the source page markup', () => {
      // Copying a link out of a web page puts an <a> next to the URL text; the
      // gesture means the same thing either way.
      const editor = editorWith('the docs');
      select(editor, 'the docs');
      paste(editor, {
        text: 'https://example.com',
        html: '<a href="https://example.com">https://example.com</a>',
      });

      expect(editor.getMarkdown()).toBe('[the docs](https://example.com)');
    });

    it('replaces the destination when the selection is already a link', () => {
      const editor = editorWith('[the docs](https://old.example)');
      select(editor, 'the docs');
      paste(editor, { text: 'https://new.example' });

      expect(editor.getMarkdown()).toBe('[the docs](https://new.example)');
    });

    it('undoes back to the selected text in one step', () => {
      const editor = editorWith('the docs');
      select(editor, 'the docs');
      paste(editor, { text: 'https://example.com' });

      editor.editor.commands.undo();

      expect(editor.getMarkdown()).toBe('the docs');
    });

    it('never links a forced plain paste', () => {
      const editor = editorWith('the docs');
      select(editor, 'the docs');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, { text: 'https://example.com' });

      expect(editor.editor.getHTML()).not.toContain('<a ');
      expect(editor.getMarkdown()).toBe('https://example.com');
    });

    it.each([
      ['a paragraph that merely contains a URL', 'see https://example.com here'],
      ['two URLs', 'https://a.example https://b.example'],
      ['a bare host with no scheme', 'example.com'],
      ['ordinary prose', 'replacement text'],
    ])('replaces the selection as an ordinary paste for %s', (_label, clipboard) => {
      const editor = editorWith('the docs');
      select(editor, 'the docs');
      paste(editor, { text: clipboard });

      expect(editor.editor.getHTML()).not.toContain('<a ');
    });

    it('leaves an empty selection to the ordinary paste', () => {
      const editor = editorWith('start');
      caretAfter(editor, 'start');
      paste(editor, { text: ' https://example.com' });

      expect(editor.editor.getHTML()).not.toContain('<a ');
      expect(editor.getMarkdown()).toBe('start https://example.com');
    });

    it('does not link a selection that spans two paragraphs', () => {
      // A selection crossing a block boundary is not link text.
      const editor = editorWith('first\n\nsecond');
      editor.editor.commands.selectAll();
      paste(editor, { text: 'https://example.com' });

      expect(editor.editor.getHTML()).not.toContain('<a ');
    });

    it('leaves a selection inside a fenced block literal', () => {
      const editor = editorWith('```\nkeep\n```');
      select(editor, 'keep');
      paste(editor, { text: 'https://example.com' });

      expect(editor.editor.getHTML()).not.toContain('<a ');
      expect(editor.getMarkdown()).toContain('https://example.com');
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
