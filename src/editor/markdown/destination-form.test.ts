import { describe, expect, it } from 'vitest';
import { buildDocument } from '../../app/editor-document';
import { AppState } from '../../app/state';
import { loadMarkdown, saveMarkdown } from '../../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../../platform/types';
import { createEditor, type EditorInstance } from '../setup';
import { markdownToHtml } from './parse';

/**
 * A destination that does not read back between parentheses, written between
 * angle brackets (#761), through the whole save path: `loadMarkdown`, the
 * editor, `buildDocument` and `saveMarkdown`, the harness of
 * `src/editor/roundtrip.test.ts`. A file of its own, so its sweep runs in a
 * worker of its own.
 */

const DOCUMENT_PATH = '/doc/notes.md';

/** A disk that records exactly what was written to it (the shape #79 uses). */
function recordingIO(disk: Map<string, string>): PlatformIO {
  return {
    // Desktop-shaped: every path carries a directory (#46).
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async (path: string) => {
      const text = disk.get(path);
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
    saveFile: async (path: string, content: string) => {
      disk.set(path, content);
    },
    readSnapshot: async (path: string): Promise<FileSnapshot> => {
      const text = disk.get(path);
      return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
    },
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async () => 'absent' as const,
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

/**
 * Open `text` as a file, change nothing, save — and return the bytes that
 * reached the disk. This is the whole path the user is on: `loadMarkdown`
 * (which is where the frontmatter is split and the line conventions are read)
 * → the editor → `buildDocument` → `saveMarkdown` (which is where the
 * conventions are re-applied). The serializer alone cannot see either end of
 * it, which is why #79 was invisible until it was measured here.
 */
async function openAndSaveUnedited(text: string): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);

  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(loaded.document.markdownBody);

  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;

  const result = await saveMarkdown(buildDocument(state, editor.getMarkdown), io);
  editor.destroy();
  host.remove();
  return result.writtenText;
}

/**
 * Open `text`, apply `edit` in the editor, save, and return the bytes written.
 */
async function openEditAndSave(
  text: string,
  edit: (editor: EditorInstance) => void,
): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(loaded.document.markdownBody);
  edit(editor);
  const app = new AppState();
  app.filePath = DOCUMENT_PATH;
  app.frontmatter = loaded.document.frontmatterRaw;
  app.lineConventions = loaded.document.lineConventions;
  const result = await saveMarkdown(buildDocument(app, editor.getMarkdown), io);
  editor.destroy();
  host.remove();
  return result.writtenText;
}

/** Select the first run of text `what` in the editor. */
function selectText(editor: EditorInstance, what: string): void {
  const { state } = editor.editor;
  let from = -1;
  state.doc.descendants((node, pos) => {
    const found = node.isText ? (node.text ?? '').indexOf(what) : -1;
    if (from < 0 && found >= 0) from = pos + found;
    return from < 0;
  });
  if (from < 0) throw new Error(`no text holds ${what}`);
  editor.editor.commands.setTextSelection({ from, to: from + what.length });
}

/** Paste `html` over the selection, as a rich paste hands it to the editor. */
function pasteHtml(editor: EditorInstance, html: string, text: string): void {
  const data: Record<string, string> = { 'text/html': html, 'text/plain': text };
  const event = {
    clipboardData: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
      files: [],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = editor.editor;
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

/** The hrefs of the links `marked`, as `parse.ts` configures it, reads in `markdown`. */
function hrefsRead(markdown: string): Array<string | null> {
  const box = document.createElement('template');
  box.innerHTML = markdownToHtml(markdown, { keepRawHtml: false });
  return Array.from(box.content.querySelectorAll('a')).map((a) => a.getAttribute('href'));
}

/** An address with its valid percent sequences decoded, a lone percent left as it is. */
function decodedAddress(address: string): string {
  return address.replace(/(%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * A link whose destination does not read back between parentheses is written
 * between angle brackets, and holds from the first save (#761). Each row is
 * saved three times and every save is asserted.
 */
describe('a destination holding white space is written between angle brackets (#761)', () => {
  it.each([
    // The reduced form of the issue: 67 bytes, then 58, 58, 58, where main
    // wrote 56, 58, 58, the second save writing the link as text.
    [
      'an address holding a space',
      'As <a href="https://example.com/a b">described here</a>, it holds.\n',
      'As [described here](<https://example.com/a b>), it holds.\n',
    ],
    [
      'a relative link holding a space',
      'See <a href="my notes.md">my notes</a>.\n',
      'See [my notes](<my notes.md>).\n',
    ],
    [
      'an address holding a tab',
      'As <a href="https://example.com/a\tb">described here</a>, it holds.\n',
      'As [described here](<https://example.com/a\tb>), it holds.\n',
    ],
    // On main the second save turned the rest of the line bold.
    [
      'an address holding angle brackets and a space',
      'As <a href="https://example.com/a<b>c d">described here</a>, it holds.\n',
      'As [described here](<https://example.com/a\\<b\\>c d>), it holds.\n',
    ],
    // An ampersand that begins a character reference is written as `&amp;`
    // between the brackets too (#447), so the address stays the inert text
    // it is: a relative path, never a `javascript:` link.
    [
      'an address holding a space and a character reference',
      'As <a href="javascript&amp;colon;alert(1) x">described here</a>, it holds.\n',
      'As [described here](<javascript&amp;colon;alert(1) x>), it holds.\n',
    ],
  ])('%s', async (_name, source, firstSave) => {
    const first = await openAndSaveUnedited(source);
    expect(first).toBe(firstSave);
    expect(hrefsRead(first)).toHaveLength(1);
    expect(await openAndSaveUnedited(first)).toBe(first);
    expect(await openAndSaveUnedited(first)).toBe(first);
  });

  it('the inert address reads as a relative path', async () => {
    const first = await openAndSaveUnedited(
      'As <a href="javascript&amp;colon;alert(1) x">described here</a>, it holds.\n',
    );
    expect(hrefsRead(first)).toEqual(['javascript&colon;alert(1)%20x']);
  });

  it('a rich paste of such a link stays a link', async () => {
    const first = await openEditAndSave('As X, it holds.\n', (editor) => {
      selectText(editor, 'X');
      pasteHtml(editor, '<a href="https://example.com/a b">described here</a>', 'described here');
    });
    expect(first).toBe('As [described here](https://example.com/a%20b), it holds.\n');
    expect(await openAndSaveUnedited(first)).toBe(first);
  });

  it('the text of such a link edited before the first save', async () => {
    const first = await openEditAndSave(
      'As <a href="https://example.com/a b">described here</a>, it holds.\n',
      (editor) => {
        selectText(editor, 'described');
        const { to } = editor.editor.state.selection;
        editor.editor.view.dispatch(editor.editor.state.tr.insertText(' just', to));
      },
    );
    expect(first).toBe('As [described just here](<https://example.com/a b>), it holds.\n');
    expect(await openAndSaveUnedited(first)).toBe(first);
  });

  // No destination holds a line break, between parentheses or angle brackets:
  // the link is written as before, and the second save writes it as text, as
  // on main. R-C2 records it.
  it('an address holding a line break is written as before', async () => {
    const first = await openAndSaveUnedited(
      'As <a href="https://example.com/a\nb">described here</a>, it holds.\n',
    );
    expect(first).toBe('As [described here](https://example.com/a\nb), it holds.\n');
    const second = await openAndSaveUnedited(first);
    expect(second).toBe('As \\[described here\\](https://example.com/a\nb), it holds.\n');
    expect(await openAndSaveUnedited(second)).toBe(second);
  });
});

/** The regression half of #761: each written byte for byte as on main. */
describe('what #761 leaves as it was', () => {
  it.each([
    [
      'an address with no white space',
      'As <a href="https://example.com/a">described here</a>, it holds.\n',
      'As [described here](https://example.com/a), it holds.\n',
    ],
    [
      'the space written %20',
      'As <a href="https://example.com/a%20b">described here</a>, it holds.\n',
      'As [described here](https://example.com/a%20b), it holds.\n',
    ],
    [
      'the angle form a file wrote',
      'As [described here](<https://example.com/a b>), it holds.\n',
      'As [described here](<https://example.com/a b>), it holds.\n',
    ],
    [
      'the raw a inside a raw block',
      '<p>As <a href="https://example.com/a b">described here</a>, it holds.</p>\n',
      '<p>As <a href="https://example.com/a b">described here</a>, it holds.</p>\n',
    ],
    ['a carried destination with an entity (#573)', '[t](/f&ouml;)\n', '[t](/f&ouml;)\n'],
    [
      'a carried destination with parentheses (#573)',
      '[t](foo(and(bar)))\n',
      '[t](foo(and(bar)))\n',
    ],
  ])('%s', async (_name, source, firstSave) => {
    const first = await openAndSaveUnedited(source);
    expect(first).toBe(firstSave);
    expect(await openAndSaveUnedited(first)).toBe(first);
  });
});

/**
 * The sweep of #761: what the address holds, a title or none, the container,
 * a mark around the link or inside its text, and the path that reaches it: a
 * raw `a`, a rich paste, the text edited before the first save. 12 x 2 x 5 x
 * 3 x 3 = 1080 shapes, each saved three times; every one holds from the first
 * save and reads as one link whose address is the one the editor holds,
 * percent sequences decoded. A pipe in a raw `a` is written `&#124;`, since a
 * bare one ends a table cell in the source itself. A space at an end of the
 * address is trimmed by the sanitizer when a file is opened, as on main; a
 * paste keeps it.
 */
describe('the sweep of a destination holding white space (#761)', () => {
  const HREFS: Record<string, string> = {
    'a space': 'https://example.com/a b',
    'a tab': 'https://example.com/a\tb',
    'two spaces': 'https://example.com/a  b',
    'a space at the end': 'https://example.com/a b ',
    'a space and parentheses': 'https://example.com/a (b)',
    'a space and angle brackets': 'https://example.com/a<b>c d',
    'a space and a backslash': 'https://example.com/a\\b c',
    'a space and a pipe': 'https://example.com/a|b c',
    'a space and letters outside ASCII': 'https://example.com/ä ö',
    'a space and a character reference': 'javascript&colon;alert(1) x',
    'the Rockwood address of three corpus files':
      'https://rockwoodleadership.org/#:~:text=balance% 2C',
    'a relative path': 'my notes.md',
  };
  const CONTAINER: Record<string, (line: string) => string> = {
    paragraph: (line) => `${line}\n`,
    heading: (line) => `# ${line}\n`,
    'list item': (line) => `- ${line}\n`,
    quote: (line) => `> ${line}\n`,
    'table cell': (line) => `| h |\n| --- |\n| ${line} |\n`,
  };
  const attribute = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\|/g, '&#124;');
  const shapes = Object.entries(HREFS).flatMap(([address, href]) =>
    [null, 'T'].flatMap((title) =>
      Object.entries(CONTAINER).flatMap(([container, wrap]) =>
        ['no mark', 'emphasis around', 'emphasis inside'].flatMap((mark) =>
          ['a raw a', 'a rich paste', 'the text edited'].map((path) => {
            const t = title === null ? '' : ` title="${title}"`;
            const inner = mark === 'emphasis inside' ? 'described <em>here</em>' : 'described here';
            const a = `<a href="${attribute(href)}"${t}>${inner}</a>`;
            const html = mark === 'emphasis around' ? `<em>${a}</em>` : a;
            const rawA = a.replace('<em>here</em>', '*here*');
            const line = `As ${mark === 'emphasis around' ? `*${rawA}*` : rawA}, it holds.`;
            return {
              name: `${address}, ${title === null ? 'no title' : 'a title'}, in a ${container}, ${mark}, by ${path}`,
              href: path === 'a rich paste' ? href : href.trim(),
              path,
              source: path === 'a rich paste' ? wrap('As X, it holds.') : wrap(line),
              html,
            };
          }),
        ),
      ),
    ),
  );

  it('counts 1080 shapes', () => {
    expect(shapes).toHaveLength(1080);
  });

  it.each(shapes)('$name', { timeout: 20000 }, async ({ href, path, source, html }) => {
    const first = await openEditAndSave(source, (editor) => {
      if (path === 'a rich paste') {
        selectText(editor, 'X');
        pasteHtml(editor, html, 'described here');
      } else if (path === 'the text edited') {
        selectText(editor, 'described');
        const { to } = editor.editor.state.selection;
        editor.editor.view.dispatch(editor.editor.state.tr.insertText(' just', to));
      }
    });
    const read = hrefsRead(first);
    expect(read).toHaveLength(1);
    expect(decodedAddress(read[0] ?? '')).toBe(decodedAddress(href));
    const second = await openAndSaveUnedited(first);
    expect(second).toBe(first);
    expect(await openAndSaveUnedited(second)).toBe(second);
  });
});
