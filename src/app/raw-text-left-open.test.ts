/**
 * The files #458 refused at open now open (#461).
 *
 * #458 refused a `script`, `style`, `title`, `xmp`, `iframe`, `noembed`,
 * `noframes` or `plaintext` left open with text after it, because the text of
 * each was not markup until its end tag and took what followed it. All eight
 * are names of the GFM tag filter, which #461 follows: the tag is text, a
 * block holding one is shown as its text and keeps its bytes, and nothing
 * after it is taken. So every file that face refused opens, and an untouched
 * save writes it back as it was. The rows are kept as #458 wrote them, so the
 * removal of that face is what they assert. The faces of #455 are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { createEditor } from '../editor/setup';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { buildDocument } from './editor-document';
import { AppState } from './state';

const PATH = '/doc/notes.md';

/** A disk that records exactly what was written to it. */
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

/** Open `text` as a file; the rejection, or null where it opened. */
async function refusalOf(text: string): Promise<unknown> {
  const disk = new Map<string, string>([[PATH, text]]);
  try {
    await loadMarkdown(PATH, recordingIO(disk));
    return null;
  } catch (refused) {
    // Refused at read: the file is exactly what it was.
    expect(disk.get(PATH)).toBe(text);
    return refused;
  }
}

/** Open `text` as a file, save it with no edits, return what was written. */
async function savedUntouched(text: string): Promise<string> {
  const disk = new Map<string, string>([[PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(PATH, io);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(loaded.document.markdownBody);
  const state = new AppState();
  state.filePath = PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;
  const result = await saveMarkdown(buildDocument(state, editor.getMarkdown), io);
  editor.destroy();
  host.remove();
  return result.writtenText;
}

const CLOSABLE = ['script', 'style', 'title', 'xmp', 'iframe', 'noembed', 'noframes'];

const CONTAINERS: ReadonlyArray<readonly [string, (line: string) => string, string]> = [
  ['a blockquote', (line) => `> ${line}`, '> '],
  ['a list item', (line) => `- ${line}`, '  '],
  ['a task item', (line) => `- [ ] ${line}`, '      '],
];

/** [label, the file, the line, the end tag the repair names] */
const REFUSED: ReadonlyArray<readonly [string, string, number, string]> = [
  ...CLOSABLE.flatMap((element) =>
    CONTAINERS.map(
      ([where, wrap, more]) =>
        [
          `${element} left open in ${where}`,
          `Before.\n\n${wrap(`<${element}>`)}\n${more}x = 1\n\nAfter.\n`,
          3,
          `</${element}>`,
        ] as const,
    ),
  ),
  ...['title', 'xmp', 'iframe', 'noembed', 'noframes'].map(
    (element) =>
      [
        `${element} left open at the top level, text after it`,
        `Before.\n\n<${element}>\nx = 1\n\nAfter.\n`,
        3,
        `</${element}>`,
      ] as const,
  ),
  ...['script', 'style'].map(
    (element) =>
      [
        `${element} left open at the top level, running to the end of the file`,
        `Before.\n\n<${element}>\nx = 1\n\nAfter.\n`,
        3,
        `</${element}>`,
      ] as const,
  ),
  [
    'a style opened inside a div, at its own line',
    'Before.\n\n<div>\n<style>\nx = 1\n\nAfter.\n',
    4,
    '</style>',
  ],
  // A control of #457, which let it open; refused by the rule of #458.
  ['the unclosed style of the #457 controls', 'Before.\n\n<style>\np{}\n\nAfter.\n', 3, '</style>'],
];

const PLAINTEXT: ReadonlyArray<readonly [string, string, number]> = [
  ['plaintext in a blockquote', 'Before.\n\n> <plaintext>\n> x = 1\n\nAfter.\n', 3],
  ['plaintext at the top level', 'Before.\n\n<plaintext>\nx = 1\n\nAfter.\n', 3],
  [
    'plaintext with an end tag, which ends nothing',
    'Before.\n\n<plaintext>\nx\n</plaintext>\n\nAfter.\n',
    3,
  ],
];

const OPENS: ReadonlyArray<readonly [string, string]> = [
  ['a textarea left open, which keeps the text', 'Before.\n\n<textarea>\nx = 1\n\nAfter.\n'],
  ['a textarea left open in a blockquote', 'Before.\n\n> <textarea>\n> x = 1\n\nAfter.\n'],
  ['a closed style (R-C2, #343)', 'Before.\n\n<style>\nx = 1\n</style>\n\nAfter.\n'],
  ['a closed style in a blockquote', 'Before.\n\n> <style>\n> x = 1\n> </style>\n\nAfter.\n'],
  [
    'a closed script holding a blank line',
    'Before.\n\n<script>\na()\n\nb()\n</script>\n\nAfter.\n',
  ],
  ['a closed xmp', 'Before.\n\n<xmp>\nx = 1\n</xmp>\n\nAfter.\n'],
  ['a style left open on the last lines of the file', 'Before.\n\n<style>\np {}\n'],
  ['a style left open in a quote that ends the file', 'Before.\n\n> <style>\n> p {}\n'],
  ['a title left open on the last lines of the file', 'Before.\n\n<title>\nx\n'],
  ['a script left open with no blank line to the end', 'Before.\n\n<script>\na()\nb()\n'],
];

describe('a raw-text element left open is not refused since #461, and saves as it was', () => {
  it.each([
    ...REFUSED.map(([label, file]) => [label, file] as const),
    ...PLAINTEXT.map(([label, file]) => [label, file] as const),
    ...OPENS,
  ])('%s', async (_label, file) => {
    expect(await refusalOf(file)).toBeNull();
    expect(await savedUntouched(file)).toBe(file);
  });
});
