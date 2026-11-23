import { describe, expect, it } from 'vitest';
import { buildDocument } from '../../app/editor-document';
import { AppState } from '../../app/state';
import { loadMarkdown, saveMarkdown } from '../../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../../platform/types';
import { createEditor } from '../setup';

/**
 * A continuation line of a task item, through the whole save path: the harness
 * of `src/editor/roundtrip.test.ts`. A file of its own, so its sweep runs in a
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

const line = (n: number) => `${' '.repeat(n)}q`;

/**
 * A continuation line of a task item takes the placement of any list item
 * (#765): four to seven spaces past the item content written with four fewer,
 * eight or more written exactly, the content standing after the list marker
 * and not after the `[ ]`. Until #765 a task item wrote four fewer at every
 * depth, so a line eight or more past moved at each save until it stood at
 * two: `- [ ] p` with `q` at ten spaces was 20, 16, 12 and 12 bytes.
 */
describe('a deep continuation line of a task item holds (#765)', () => {
  it.each(['- [ ] p', '- [x] p'].flatMap((item) => [10, 12, 14].map((n) => [item, n] as const)))(
    '%s, q at %i spaces, is written exactly',
    async (item, n) => {
      const source = `${item}\n${line(n)}\n`;
      const first = await openAndSaveUnedited(source);
      expect(first).toBe(source);
      expect(await openAndSaveUnedited(first)).toBe(source);
      expect(await openAndSaveUnedited(source)).toBe(source);
    },
  );

  it.each([
    // 28, 24, 20, 20 bytes before #765.
    ['a task item nested in a bullet item, q at 12', '- a\n  - [ ] p\n            q\n'],
    // 32, 24, 16, 16 bytes before #765.
    ['two continuation lines at 10', '- [ ] p\n          q\n          q\n'],
    // 25, 21, 17, 17 bytes before #765.
    ['a second paragraph, its continuation at 10', '- [ ] p\n\n  r\n          q\n'],
  ])('%s holds byte for byte', async (_name, source) => {
    const first = await openAndSaveUnedited(source);
    expect(first).toBe(source);
    expect(await openAndSaveUnedited(first)).toBe(source);
  });
});

/** The regression half of #765: each written byte for byte as on main. */
describe('what #765 leaves as it was', () => {
  // The indentation each first save writes, measured on main at `ec8d9d4`.
  const expected = (n: number, content: number): number =>
    n - content >= 4 && n - content <= 7 ? n - 4 : n;
  it.each(
    ['- [ ] p', '- [x] p'].flatMap((item) =>
      [2, 3, 4, 5, 6, 7, 8, 9].map((n) => [item, n] as const),
    ),
  )('%s, q at %i spaces', async (item, n) => {
    const written = `${item}\n${line(expected(n, 2))}\n`;
    expect(await openAndSaveUnedited(`${item}\n${line(n)}\n`)).toBe(written);
    expect(await openAndSaveUnedited(written)).toBe(written);
  });

  it.each(Array.from({ length: 13 }, (_, i) => i + 2).map((n) => ['- p', n, 2] as const))(
    'a bullet item %s, q at %i spaces',
    async (item, n, content) => {
      const written = `${item}\n${line(expected(n, content))}\n`;
      expect(await openAndSaveUnedited(`${item}\n${line(n)}\n`)).toBe(written);
      expect(await openAndSaveUnedited(written)).toBe(written);
    },
  );

  it.each(Array.from({ length: 12 }, (_, i) => i + 3).map((n) => ['1. p', n, 3] as const))(
    'an ordered item %s, q at %i spaces',
    async (item, n, content) => {
      const written = `${item}\n${line(expected(n, content))}\n`;
      expect(await openAndSaveUnedited(`${item}\n${line(n)}\n`)).toBe(written);
      expect(await openAndSaveUnedited(written)).toBe(written);
    },
  );
});

/**
 * The sweep of #765: the task item (unticked, ticked, the markers `*` and
 * `+`, nested in a bullet item, nested in an ordered item, in a quote), where
 * the line stands (the first paragraph, a second paragraph after a blank
 * line, after a nested list, after a closed fence, after a heading, after an
 * indented code block), one line or two, a tight or a loose list, and the
 * indentation at the boundaries of the placement: 2, 6 and 9, 10, and 14, which
 * moved twice before. 7 x 6 x 2 x 2 x 5 = 840 shapes, each saved three times;
 * every one holds from the first save. The step zero measured every
 * indentation from 2 to 20 over these and the bullet and ordered items, 4560
 * shapes, read by `marked`, commonmark.js and cmark-gfm, the text of each item
 * unchanged.
 */
describe('the sweep of a continuation line of a task item (#765)', () => {
  const ITEMS: ReadonlyArray<readonly [string, string, string, string]> = [
    ['unticked', '', '', '- [ ] '],
    ['ticked', '', '', '- [x] '],
    ['the marker *', '', '', '* [ ] '],
    ['the marker +', '', '', '+ [ ] '],
    ['nested in a bullet item', '- a\n', '  ', '- [ ] '],
    ['nested in an ordered item', '1. a\n', '   ', '- [ ] '],
    ['in a quote', '', '> ', '- [ ] '],
  ];
  const POSITIONS = [
    'the first paragraph',
    'a second paragraph',
    'after a nested list',
    'after a closed fence',
    'after a heading',
    'after an indented code block',
  ];
  const shapes = ITEMS.flatMap(([item, before, prefix, marker]) =>
    POSITIONS.flatMap((position) =>
      [1, 2].flatMap((lines) =>
        [false, true].flatMap((loose) =>
          [2, 6, 9, 10, 14].map((n) => {
            const c = `${prefix}  `;
            const blank = prefix.trimEnd();
            const head: Record<string, string[]> = {
              'the first paragraph': [`${prefix}${marker}p`],
              'a second paragraph': [`${prefix}${marker}p`, blank, `${c}r`],
              'after a nested list': [`${prefix}${marker}p`, `${c}- s`, blank, `${c}r`],
              'after a closed fence': [
                `${prefix}${marker}p`,
                `${c}\`\`\``,
                `${c}x`,
                `${c}\`\`\``,
                `${c}r`,
              ],
              'after a heading': [`${prefix}${marker}p`, `${c}# h`, `${c}r`],
              'after an indented code block': [
                `${prefix}${marker}p`,
                blank,
                `${c}    code`,
                blank,
                `${c}r`,
              ],
            };
            const deep = `${prefix}${' '.repeat(n)}`;
            const body = [...head[position], `${deep}q`, ...(lines === 2 ? [`${deep}q2`] : [])];
            const tail = loose ? [blank, `${prefix}${marker}z`] : [`${prefix}${marker}z`];
            return {
              name: `${item}, ${position}, ${lines} line(s), ${loose ? 'loose' : 'tight'}, at ${n}`,
              source: `${before}${[...body, ...tail].join('\n')}\n`,
            };
          }),
        ),
      ),
    ),
  );

  it('counts 840 shapes', () => {
    expect(shapes).toHaveLength(840);
  });

  it.each(shapes)('$name', { timeout: 20000 }, async ({ source }) => {
    const first = await openAndSaveUnedited(source);
    const second = await openAndSaveUnedited(first);
    expect(second).toBe(first);
    expect(await openAndSaveUnedited(second)).toBe(second);
  });
});
