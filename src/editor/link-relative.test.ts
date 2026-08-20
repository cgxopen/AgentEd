import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

/**
 * #42: a relative link must survive open → save byte for byte (R-C2).
 *
 * This goes through the **editor** — `setMarkdown` → ProseMirror → `getMarkdown`
 * — not through the parser/serializer pair that `markdown/roundtrip.test.ts`
 * exercises. That is the whole point: the mark was dropped inside TipTap, by
 * `@tiptap/extension-link`'s own `isAllowedUri`, so a test that never builds a
 * document could not see it. Before this fix, `[here](docs/guide.md)` came back
 * as bare `here` — the destination gone from the user's file, on a save with no
 * edits.
 */
let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('relative links survive the editor (R-C2)', () => {
  it.each([
    ['a path with a directory', '[here](docs/guide.md)'],
    ['a nested path', '[ADR](docs/ADR/ADR-001.md)'],
    ['an explicitly relative path', '[notes](./notes.md)'],
    ['a bare file name', '[notes](notes.md)'],
    ['a parent path', '[up](../a/b.md)'],
    ['a root-relative path', '[x](/docs/x.md)'],
    ['an anchor', '[section](#section)'],
    ['a path with a query', '[img](images/x.png?raw=1)'],
    ['a web address', '[docs](https://example.com/a)'],
  ])('keeps %s unchanged on open → save', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
  });
});

/**
 * The override widens the extension's allow-list by one case and narrows it by
 * none. These pin the "by none" half: refusing every scheme the dialog refuses
 * would have taken the destination out of a `tel:` or `ftp:` link on open —
 * introducing the very kind of R-C2 exception #42 exists to remove.
 */
describe('the override takes nothing away (R-C2)', () => {
  it.each([
    ['a web address', '[docs](https://example.com/a)'],
    ['a mail address', '[write](mailto:hi@example.com)'],
    ['a telephone address', '[call](tel:+15551234567)'],
    ['an ftp address', '[get](ftp://example.com/x)'],
    ['a protocol-relative address', '[pr](//cdn.example.com/x)'],
  ])('keeps %s exactly as the build kept it before', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  // Not a change either: DOMPurify strips these hrefs in `markdownToHtml`, so
  // the anchor reaches TipTap with nothing to keep. Recorded because the
  // override must never be the thing that lets one through.
  it.each([
    ['a script address', '[js](javascript:alert1)', 'js'],
    ['a data address', '[d](data:text/html,x)', 'd'],
  ])('still refuses %s, as the build did', (_label, markdown, expected) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown()).toBe(expected);
  });
});

/**
 * `setLink` consults the same allow-list, so the dialog accepting an address
 * the command then refuses would insert nothing and say nothing — the silence
 * #13 forbids. Asserted by the document changing, never by the return value.
 */
describe('setLink inserts every address the dialog accepts', () => {
  it.each([
    './notes.md',
    'notes.md',
    'docs/guide.md',
    'docs/ADR/ADR-001.md',
    '../a/b.md',
    '/docs/x.md',
    '#section',
    'images/x.png?raw=1',
    'example.com',
    'README.md',
    'https://example.com',
  ])('inserts %s', (href) => {
    const editor = editorWith('the docs');
    editor.editor.commands.setTextSelection({ from: 1, to: 9 });
    editor.editor.chain().focus().setLink({ href }).run();

    expect(editor.getMarkdown()).toBe(`[the docs](${href})`);
  });
});
