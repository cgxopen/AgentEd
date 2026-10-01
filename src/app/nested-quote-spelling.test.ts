/**
 * A nested quote is written with a space between its markers, and with a
 * blank quote line above it where the file had none (R-C2 known exception,
 * #20).
 *
 * `>>` and `> >` read as the same two quotes, and a quote opening on the
 * line under a paragraph of its parent reads as it does a blank quote line
 * further down: the document holds one quote inside another and nothing
 * saying how the file spelled either. The serializer writes each level as
 * `> ` and separates the blocks of a quote with a blank quote line, spelled
 * as the quote spells one where it already has one (#199) and `> ` where it
 * has none. Measured on `7a3d3e6`. The rendering is the same, asserted
 * below, and the file holds still after the first save.
 */
import { describe, expect, it } from 'vitest';
import { BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE } from '../editor/markdown/blockquote-spacing';
import { markdownToHtml } from '../editor/markdown/parse';
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

/** Open `text` as a file, save it with no edits, return what was written. */
async function openAndSaveUnedited(text: string): Promise<string> {
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

  // What the caller records as the R-C14 baseline must be what landed
  // on disk, so the two are asserted to agree here rather than trusted.
  expect(result.writtenText).toBe(disk.get(PATH));
  return result.writtenText;
}

/** [label, the file, what an untouched save writes] - bytes in the labels. */
const ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['two markers written together, 5 bytes to 6', '>> x\n', '> > x\n'],
  ['three markers written together, 9 bytes to 11', '>>> deep\n', '> > > deep\n'],
  [
    'a nested quote under its parent line, 18 bytes to 22',
    '> quote\n>> nested\n',
    '> quote\n> \n> > nested\n',
  ],
  ['the same with the markers already spaced, 10 bytes to 13', '> a\n> > b\n', '> a\n> \n> > b\n'],
  [
    'a bare blank quote line already there keeps its spelling, 20 bytes to 21',
    '> quote\n>\n>> nested\n',
    '> quote\n>\n> > nested\n',
  ],
  ['the spelling it writes, unchanged', '> > x\n', '> > x\n'],
  [
    'the spelling it writes with a parent line, unchanged',
    '> quote\n> \n> > nested\n',
    '> quote\n> \n> > nested\n',
  ],
];

const withoutBlankMarker = (html: string): string =>
  html.replace(new RegExp(` ${BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE}="[^"]*"`, 'g'), '');

describe('a nested quote is written with spaced markers (R-C2, #20)', () => {
  it.each(ROWS)('%s', async (_label, file, written) => {
    expect(await openAndSaveUnedited(file)).toBe(written);
  });

  it.each(ROWS)('%s - and the second save moves nothing', async (_label, file) => {
    const once = await openAndSaveUnedited(file);
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it.each(ROWS)('%s - and renders as the file did', (_label, file, written) => {
    expect(withoutBlankMarker(markdownToHtml(written))).toBe(
      withoutBlankMarker(markdownToHtml(file)),
    );
  });
});
