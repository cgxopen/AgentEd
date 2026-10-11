import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * A link the file wrote in angle brackets keeps them while it is untouched
 * (#567). See `markdown/angle-autolink.ts` for the route; the unedited save of
 * the whole path is pinned by the CommonMark suite.
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

function paste(instance: EditorInstance, clipboard: { text?: string; html?: string }): void {
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
  const { view } = instance.editor;
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

/** The position of the first character of `text` in the document. */
function positionOf(instance: EditorInstance, text: string): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text);
    }
  });
  if (found === -1) throw new Error(`no ${text} in the document`);
  return found;
}

describe('an unedited save keeps an autolink in its brackets (#567)', () => {
  it.each([
    ['an https autolink', 'See <https://example.com> now.'],
    ['an http autolink', 'See <http://example.com/a?b=c&d> now.'],
    ['a mailto autolink', 'Write to <mailto:a@example.com> now.'],
    ['an email autolink, which marked reads as mailto', 'Write to <a@example.com> now.'],
    ['two autolinks on one line', '<https://a.example> and <https://b.example>'],
    ['an autolink in a list item', '- <https://example.com>'],
    // `marked` encodes the address, `\\*` as `%5C*`; the text still gives it back.
    ['an autolink whose address marked encodes', 'Find <https://example.com?find=\\*> here.'],
  ])('%s', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });
});

describe('what stays as it was (#567)', () => {
  it('a bare URL stays text, never a link (R-C13)', () => {
    const editor = editorWith('See https://example.com now.');
    expect(editor.editor.getHTML()).not.toContain('<a ');
    expect(editor.getMarkdown()).toBe('See https://example.com now.');
  });

  it('an inline link whose text equals its address stays an inline link', () => {
    const markdown = '[https://example.com](https://example.com)';
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });
});

describe('an autolink that is no longer what the brackets say is an inline link (#567)', () => {
  it('its text edited', () => {
    const editor = editorWith('See <https://example.com> now.');
    const at = positionOf(editor, 'example');
    editor.editor.chain().setTextSelection(at).insertContent('my').run();
    expect(editor.getMarkdown()).toBe('See [https://myexample.com](https://example.com) now.');
  });

  it('its address changed in the link dialog', () => {
    const editor = editorWith('See <https://example.com> now.');
    const at = positionOf(editor, 'example');
    // The command the link dialog runs (`src/app/link-dialog.ts`).
    editor.editor
      .chain()
      .setTextSelection(at)
      .extendMarkRange('link')
      .setLink({ href: 'https://other.example' })
      .run();
    expect(editor.getMarkdown()).toBe('See [https://example.com](https://other.example) now.');
  });
});

describe('an autolink inside a mark is an inline link (#567)', () => {
  it('inside an emphasis, so the emphasis is kept', () => {
    // The link mark is outermost, so the link holds the emphasis, not text.
    expect(editorWith('*see <https://example.com>*').getMarkdown()).toBe(
      '*see* [*https://example.com*](https://example.com)',
    );
  });
});

describe('a link that did not come from the file has no brackets (#567)', () => {
  it('a new link made in the editor is an inline link', () => {
    const editor = editorWith('See https://example.com now.');
    const at = positionOf(editor, 'https');
    editor.editor
      .chain()
      .setTextSelection({ from: at, to: at + 'https://example.com'.length })
      .setLink({ href: 'https://example.com' })
      .run();
    expect(editor.getMarkdown()).toBe('See [https://example.com](https://example.com) now.');
  });

  it('a rich paste writes an inline link', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, {
      html: '<p><a href="https://example.com">https://example.com</a></p>',
      text: 'https://example.com',
    });
    expect(editor.getMarkdown()).toBe('[https://example.com](https://example.com)start');
  });

  it('a page that spells the attribute gets no brackets (#447)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, {
      html: '<p><a data-autolink="" href="https://example.com">https://example.com</a></p>',
      text: 'https://example.com',
    });
    expect(editor.getMarkdown()).toBe('[https://example.com](https://example.com)start');
  });
});
