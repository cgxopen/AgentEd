import { getTextBetween, getTextSerializersFromSchema } from '@tiptap/core';
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

  describe('a copy from this window is left to ProseMirror', () => {
    /** What this window puts on the clipboard for a copy of the whole document. */
    function copied(editorInstance: EditorInstance): string {
      const { view, state } = editorInstance.editor;
      const slice = state.doc.slice(0, state.doc.content.size);
      return view.serializeForClipboard(slice).dom.innerHTML;
    }

    it('recognises what it copied, by the token it wrote (#447)', () => {
      const html = copied(editorWith('* one\n* two'));
      expect(html).toContain('data-pm-slice');
      expect(isInternalPaste(html)).toBe(true);
    });

    it('does not take data-pm-slice alone for its own, since any page can spell it (#447)', () => {
      expect(isInternalPaste('<p data-pm-slice="1 1 []">text</p>')).toBe(false);
      expect(isInternalPaste('<p>text</p>')).toBe(false);
      expect(
        isInternalPaste('<p data-pm-slice="1 1 []" data-agented-copy="0123456789abcdef">text</p>'),
      ).toBe(false);
    });

    it('does not handle its own copy itself', () => {
      const source = editorWith('text');
      const html = copied(source);
      const editor = editorWith('');
      expect(paste(editor, { text: 'text', html })).toBe(false);
    });

    it('keeps what the pipeline stamped on its own copy: a list marker survives copy and paste', () => {
      const html = copied(editorWith('* one\n* two'));
      const target = editorWith('');
      // Through the handler, as the app pastes: it declines its own copy, and
      // ProseMirror then reads the HTML as it is.
      if (!paste(target, { text: 'one\ntwo', html })) target.editor.view.pasteHTML(html);
      expect(target.getMarkdown()).toBe('* one\n* two');
    });
  });

  describe('a copy from another AgentEd window is foreign (#447, the R-C2 exception)', () => {
    // Each window makes its own token, so a copy carrying another one is
    // cleaned like any foreign HTML: what the pipeline stamped is taken out
    // and the construct arrives the way the editor writes it by default.
    it('a list marker arrives as the default one', () => {
      const source = editorWith('* one\n* two');
      const { view, state } = source.editor;
      const html = view
        .serializeForClipboard(state.doc.slice(0, state.doc.content.size))
        .dom.innerHTML.replace(/data-agented-copy="[0-9a-f]+"/, 'data-agented-copy="0000"');
      const target = editorWith('');
      paste(target, { text: 'one\ntwo', html });
      expect(target.getMarkdown()).toBe('- one\n- two');
    });

    it('an HTML comment is lost, and the words around it arrive', () => {
      const source = editorWith('before <!-- note --> after');
      const { view, state } = source.editor;
      const html = view
        .serializeForClipboard(state.doc.slice(0, state.doc.content.size))
        .dom.innerHTML.replace(/data-agented-copy="[0-9a-f]+"/, 'data-agented-copy="0000"');
      const target = editorWith('');
      paste(target, { text: 'before  after', html });
      const saved = target.getMarkdown();
      expect(saved).not.toContain('note');
      expect(saved).toContain('before');
      expect(saved).toContain('after');
    });
  });

  describe('a copy from AgentEd: Ctrl+V into a code block gives the words, Ctrl+Shift+V the characters (#697)', () => {
    const SOURCE =
      '# A heading\n\nWords with a **bold** word and a [link](https://example.com/a).\n\n- first item\n- second item\n\n```\ncode\n```';

    /**
     * Both flavours of a copy from a document, the plain text the markdown of
     * #697, and the words TipTap writes for the same selection, the plain text
     * of every copy on `main`.
     */
    function copyFrom(
      markdown: string,
      from: string,
      to: string,
    ): { text: string; html: string; words: string } {
      const source = editorWith(markdown);
      const at = (needle: string) => {
        let found = -1;
        source.editor.state.doc.descendants((node, pos) => {
          if (found < 0 && node.isText && node.text?.includes(needle)) {
            found = pos + node.text.indexOf(needle);
          }
        });
        return found;
      };
      source.editor.commands.setTextSelection({ from: at(from), to: at(to) + to.length });
      const { view, state, schema } = source.editor;
      const { dom, text } = view.serializeForClipboard(state.selection.content());
      const words = getTextBetween(
        state.doc,
        { from: state.selection.from, to: state.selection.to },
        { textSerializers: getTextSerializersFromSchema(schema) },
      );
      source.destroy();
      return { text, html: dom.innerHTML, words };
    }

    function intoCodeBlock(clipboard: Clipboard): string {
      const editor = editorWith('```\ncode\n```');
      caretAfter(editor, 'code');
      paste(editor, clipboard);
      return editor.editor.state.doc.firstChild?.textContent ?? '';
    }

    it('the plain text of the copy is its markdown', () => {
      expect(copyFrom(SOURCE, 'bold', 'bold').text).toBe('**bold**');
    });

    it('Ctrl+V into a code block inserts the words of a bold word', () => {
      expect(intoCodeBlock(copyFrom(SOURCE, 'bold', 'bold'))).toBe('codebold\n');
    });

    it('Ctrl+V into a code block inserts the words of a heading, a paragraph and a list', () => {
      const clipboard = copyFrom(SOURCE, 'A heading', 'second item');
      expect(clipboard.text).toContain('# A heading');
      expect(clipboard.words).toBe(
        'A heading\n\nWords with a bold word and a link.\n\n\n\n\n\nfirst item\n\n\n\nsecond item',
      );
      expect(intoCodeBlock(clipboard)).toBe(`code${clipboard.words}\n`);
    });

    it('a copy from another window, its token unknown here, gives the words too', () => {
      const clipboard = copyFrom(SOURCE, 'bold', 'bold');
      const html = clipboard.html.replace(
        /data-agented-copy="[0-9a-f]+"/,
        'data-agented-copy="0000"',
      );
      expect(intoCodeBlock({ text: clipboard.text, html })).toBe('codebold\n');
    });

    it('HTML without the copy attribute is pasted into a code block as its plain text', () => {
      expect(intoCodeBlock({ text: '**bold**', html: '<p><strong>bold</strong></p>' })).toBe(
        'code**bold**\n',
      );
    });

    it('Ctrl+Shift+V inserts the markdown as characters, the paste carrying the plain text alone', () => {
      const { text } = copyFrom(SOURCE, 'bold', 'bold');
      const editor = editorWith('start');
      caretAfter(editor, 'start');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, { text });
      expect(editor.editor.getText()).toBe('start**bold**');
      expect(editor.getMarkdown()).toBe('start\\*\\*bold\\*\\*');
    });

    it('Ctrl+Shift+V inserts the characters even where a platform hands it the HTML', () => {
      const clipboard = copyFrom(SOURCE, 'bold', 'bold');
      const editor = editorWith('start');
      caretAfter(editor, 'start');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, clipboard);
      expect(editor.editor.getText()).toBe('start**bold**');
    });

    it('Ctrl+Shift+V into a code block inserts the characters', () => {
      const { text } = copyFrom(SOURCE, 'bold', 'bold');
      const editor = editorWith('```\ncode\n```');
      caretAfter(editor, 'code');
      storageOf(editor).plainPasteRequestedAt = Date.now();
      paste(editor, { text });
      expect(editor.editor.state.doc.firstChild?.textContent).toBe('code**bold**\n');
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
