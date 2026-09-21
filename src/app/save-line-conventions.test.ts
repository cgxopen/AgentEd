/**
 * #79 at the level the user meets it: open a file, change nothing,
 * save — and the bytes on disk are the bytes that were there (R-C2).
 *
 * The run goes through the **real save assembly**, which is the level
 * the defect was measured at: `loadMarkdown` against a recording
 * `PlatformIO` → `createEditor` + `setMarkdown` → `buildBundle` →
 * `saveMarkdown`, with the text handed to `io.saveFile` compared
 * against the text `io.readText` returned. The pair-level
 * `markdown/roundtrip.test.ts` cannot see any of this: the convention
 * is imposed after the serializer, on the assembled text.
 *
 * The fixtures are purpose-built — heading, paragraph, list, fenced
 * block, a link, an image reference — and deliberately contain no
 * `**[…]**`, no bold across inline code and no strikethrough, so that
 * #84 and #85 stay out of an assertion about line endings. The
 * repository's own `CLAUDE.md` carries all three shapes, which is why
 * it is checked by counting terminators rather than by equality.
 *
 * Measured on `main` before the fix, every one of these failed: `\r`
 * out was 0 for every CRLF fixture, and the final newline was gone from
 * every fixture that had one.
 */
import { describe, expect, it } from 'vitest';
import claudeMd from '../../CLAUDE.md?raw';
import { createEditor } from '../editor/setup';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { buildBundle } from './bundle';
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
  editor.setMarkdown(loaded.bundle.markdownBody);

  const state = new AppState();
  state.filePath = PATH;
  state.frontmatter = loaded.bundle.frontmatterRaw;
  state.lineConventions = loaded.bundle.lineConventions;

  const result = await saveMarkdown(buildBundle(state, editor.getMarkdown), io);

  editor.destroy();
  host.remove();

  // What the caller records as the R-C14 baseline must be what landed
  // on disk, so the two are asserted to agree here rather than trusted.
  expect(result.writtenText).toBe(disk.get(PATH));
  return result.writtenText;
}

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

/** No `**[…]**`, no bold across inline code, no strikethrough — see the header. */
const BODY = [
  '# Title',
  '',
  'A paragraph with a [link](docs/guide.md) and an image ![alt](assets/a.png).',
  '',
  '- one',
  '- two',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
].join('\n');

const withFrontmatter = `---\ntitle: Notes\ndate: 2026-08-22\n---\n${BODY}`;
const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
const noFinalNewline = (text: string): string => text.replace(/\r?\n$/, '');

describe('open → save with no edits does not alter the file (R-C2, #79)', () => {
  it.each([
    ['CRLF with frontmatter', crlf(withFrontmatter)],
    ['CRLF without frontmatter', crlf(BODY)],
    ['CRLF with a fenced block and a list', crlf(BODY)],
    ['LF with a final newline', BODY],
    ['LF with frontmatter', withFrontmatter],
    ['LF without a final newline', noFinalNewline(BODY)],
    ['CRLF without a final newline', noFinalNewline(crlf(BODY))],
  ])('leaves %s byte-identical', async (_label, text) => {
    expect(await openAndSaveUnedited(text)).toBe(text);
  });
});

describe('a real document — this repository’s CLAUDE.md as CRLF', () => {
  /**
   * Counted, not compared: `CLAUDE.md` carries the mark shapes #84 and
   * #85 describe, and this issue is not theirs. What is asserted is
   * exactly what #79 is about — every line ends with `\r\n`, no line
   * was gained or lost, and the file still ends with a terminator.
   */
  const asCrlf = claudeMd.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

  it('keeps every terminator CRLF, and keeps the final newline', async () => {
    const written = await openAndSaveUnedited(asCrlf);

    expect(occurrences(written, '\n')).toBe(occurrences(asCrlf, '\n'));
    expect(occurrences(written, '\r\n')).toBe(occurrences(asCrlf, '\r\n'));
    // Every `\n` is preceded by `\r`, and none is doubled.
    expect(occurrences(written, '\n')).toBe(occurrences(written, '\r\n'));
    expect(written).not.toContain('\r\r');
    expect(written.endsWith('\r\n')).toBe(true);
  });
});

describe('what the conventions do not preserve', () => {
  /**
   * Measured for #79 and recorded in R-C2 as a known exception: the
   * first terminator in the file decides the whole file. Preserving a
   * per-line mix would mean carrying a terminator per line through
   * ProseMirror — the reach into serialization this defect is not worth.
   */
  it('writes a mixed file with the terminator its first line used', async () => {
    const mixed = '# Title\r\n\r\nFirst.\n\nSecond.\r\n';
    expect(await openAndSaveUnedited(mixed)).toBe('# Title\r\n\r\nFirst.\r\n\r\nSecond.\r\n');
  });

  /**
   * Measured for #79 and recorded in R-C2: a file ending in a run of
   * blank lines comes back with exactly one terminator. The run is
   * already gone before the save assembly sees the text — the editor
   * has no node for a trailing blank line — so preserving it would mean
   * reconstructing something the document no longer contains.
   */
  it('collapses a run of trailing blank lines to one terminator', async () => {
    const written = await openAndSaveUnedited(`${BODY}\n\n`);
    expect(written).toBe(BODY);
  });
});
