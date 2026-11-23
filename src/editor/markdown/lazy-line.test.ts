import { marked, type Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { buildDocument } from '../../app/editor-document';
import { AppState } from '../../app/state';
import { loadMarkdown, saveMarkdown } from '../../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../../platform/types';
import { createEditor } from '../setup';
import { MAX_ROUNDS } from './lazy-line';
import { markdownToHtml } from './parse';

/**
 * A lazy line after a blank line in a list item (#758), through the parse and
 * through the whole save path: the harness of `src/editor/roundtrip.test.ts`.
 * A file of its own, so its sweep runs in a worker of its own.
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

/** The tags that say what holds what, in the order the parse writes them. */
const structure = (md: string): string =>
  (
    markdownToHtml(md, { keepRawHtml: false }).match(/<\/?(ul|ol|li|pre|blockquote|p)\b/g) ?? []
  ).join('');

/** The source and three unedited saves, in bytes. */
async function threeSaves(source: string): Promise<{ saves: string[]; bytes: number[] }> {
  const saves = [source];
  for (let i = 0; i < 3; i += 1) saves.push(await openAndSaveUnedited(saves[saves.length - 1]));
  return { saves, bytes: saves.map((s) => new TextEncoder().encode(s).length) };
}

/**
 * A lazy line after a blank line in a list item continues the item, as
 * commonmark.js reads it (#758). Each row asserts what the parse reads, the
 * same as commonmark.js on the step zero, and the bytes of three saves.
 */
describe('a lazy line after a blank line in a list item continues the item (#758)', () => {
  it.each([
    // The two reduced forms of the issue. Until #758 the four lines read a
    // paragraph under the list, and the fourteen a code block from the first
    // fence to the end of the document: 102, 88, 86 and 86 bytes.
    [
      'the four lines of the issue',
      '1. One\n\n   Two\nlazy.\n',
      '<ol<li<p</p<p</p</li</ol',
      [21, 24, 24, 24],
    ],
    [
      'the fourteen lines of the issue',
      '2. Two:\n\n   Para one\nlazy line.\n\n   ```js\n   a();\n     ```\n\n3.  Three\n\n    ```console\n    $ x\n    ```\n',
      '<ol<li<p</p<p</p<pre</pre</li<li<p</p<pre</pre</li</ol',
      [102, 99, 99, 99],
    ],
    ['a bullet item', '- One\n\n  Two\nlazy.\n', '<ul<li<p</p<p</p</li</ul', [19, 21, 21, 21]],
    [
      'a nested item',
      '- a\n\n  - One\n\n    Two\n  lazy.\n',
      '<ul<li<p</p<ul<li<p</p<p</p</li</ul</li</ul',
      [30, 32, 32, 32],
    ],
    [
      'two blank lines apart',
      '- One\n\n\n  Two\nlazy.\n',
      '<ul<li<p</p<p</p</li</ul',
      [20, 22, 22, 22],
    ],
    [
      'a quote in the item, the lazy line under it',
      '- One\n\n  > Two\nlazy.\n',
      '<ul<li<p</p<blockquote<p</p</blockquote</li</ul',
      [21, 25, 25, 25],
    ],
    [
      'an item after the lazy line',
      '1. One\n\n   Two\nlazy.\n2. Three\n',
      '<ol<li<p</p<p</p</li<li<p</p</li</ol',
      [30, 33, 33, 33],
    ],
  ] as const)('%s', async (_name, source, read, bytes) => {
    expect(structure(source)).toBe(read);
    expect((await threeSaves(source)).bytes).toEqual(bytes);
  });

  it('writes the lazy line indented to the item, as R-C2 writes one (#571)', async () => {
    expect(await openAndSaveUnedited('1. One\n\n   Two\nlazy.\n')).toBe(
      '1. One\n\n   Two\n   lazy.\n',
    );
  });

  // The shape of `plugins_services.md` of docker/docs: a line indented less
  // than the item inside an open fence of the item, after a blank line, ends
  // the item, as commonmark.js reads it. `marked` takes that line into the
  // code block from 17.0.2 on, so an update of `marked` turns this row red.
  it('a line inside an open fence of the item ends the item', () => {
    expect(structure('1. One\n\n   ```\n   x\nlazy.\n   ```\n')).toBe(
      '<ol<li<p</p<pre</pre</li</ol<p</p<pre</pre',
    );
  });

  // A lexer made inside the tokenizer takes the shared tokenizer over; it is
  // given back, or the text of the item was lexed into that lexer and lost.
  it('keeps the text of the item that holds the lazy line', () => {
    const html = markdownToHtml('- One\n\n  > Two\nlazy.\n', { keepRawHtml: false });
    expect(html).toMatch(/<li><p>One<\/p>\s*<blockquote>\s*<p>Two<span[^>]*> <\/span>lazy\.<\/p>/);
  });

  it('reads a second document after one with lazy lines as it reads it alone', () => {
    const second = '- a *b* [c](https://x.org/)\n\n  d `e`\n\n1. f\n';
    const alone = markdownToHtml(second);
    markdownToHtml('1. One\n\n   Two\nlazy.\n\n- One\n\n  > Two\nlazy.\n');
    expect(markdownToHtml(second)).toBe(alone);
  });

  it.each([
    ['at depth 0', '1. One\n\n   Two\nlazy.\nmore.\n2. Three\n\n   Four\nlazy.\n'],
    ['at depth 1', '- a\n\n  1. One\n\n     Two\n  lazy.\n  2. Three\n'],
  ])('keeps the raw of the list and of each item the slice of the file, %s', (_name, source) => {
    const list = marked.lexer(source)[0] as Tokens.List;
    expect(list.type).toBe('list');
    expect(source.startsWith(list.raw)).toBe(true);
    let at = 0;
    for (const item of list.items) {
      expect(source.slice(at, at + item.raw.length)).toBe(item.raw);
      at += item.raw.length;
    }
    const nested = list.items[0].tokens.find((t) => t.type === 'list') as Tokens.List | undefined;
    if (nested !== undefined) {
      const text = list.items[0].text;
      expect(text.includes(nested.raw)).toBe(true);
      let from = text.indexOf(nested.raw);
      for (const item of nested.items) {
        expect(text.slice(from, from + item.raw.length)).toBe(item.raw);
        from += item.raw.length;
      }
    }
  });

  // Each round tokenizes the list again from its start, so a list where every
  // item holds a lazy line costs a round per item: past MAX_ROUNDS the rest of
  // the list is read as before #758, the lazy line a paragraph under the list.
  it('reads the rest of the list as before past the bound', () => {
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => `- One ${i}\n\n  Two ${i}\nlazy ${i}.\n`).join('');
    const within = markdownToHtml(items(MAX_ROUNDS), { keepRawHtml: false });
    expect(within.split('</ul>')).toHaveLength(2);
    expect(within.split('</ul>')[1].trim()).toBe('');
    const past = markdownToHtml(items(MAX_ROUNDS + 1), { keepRawHtml: false });
    const [list, after] = past.split('</ul>');
    expect((list.match(/<li\b/g) ?? []).length).toBe(MAX_ROUNDS + 1);
    expect(after.trim()).toBe(`<p>lazy ${MAX_ROUNDS}.</p>`);
  });
});

/** The regression half of #758: each read and written as on main. */
describe('what #758 leaves as it was', () => {
  it.each([
    ['no blank line', '1. One\n   Two\nlazy.\n', '<ol<li</li</ol', [20, 23, 23, 23]],
    [
      'a line right after the blank line',
      '1. One\n\nlazy.\n',
      '<ol<li</li</ol<p</p',
      [14, 14, 14, 14],
    ],
    [
      'a line after indented code',
      '1. One\n\n       code\nlazy.\n',
      '<ol<li<p</p<pre</pre</li</ol<p</p',
      [26, 36, 36, 36],
    ],
    [
      'a line after a closed fence',
      '1. One\n\n   ```\n   x\n   ```\nlazy.\n',
      '<ol<li<p</p<pre</pre</li</ol<p</p',
      [33, 33, 33, 33],
    ],
  ] as const)('%s', async (_name, source, read, bytes) => {
    expect(structure(source)).toBe(read);
    expect((await threeSaves(source)).bytes).toEqual(bytes);
  });
});

/**
 * The sweep of #758: where the lazy line stands (after a blank line and a
 * paragraph line, in an item opening with a blank line, under a quote in the
 * item, in a nested item), what stands right above it (a paragraph line, a
 * blank line, indented code, an open fence, a closed fence, a heading, a
 * thematic break, an HTML block, a table row), what follows (an item, a fence
 * indented to the item, a paragraph, the end), the item (bullet, ordered, a
 * wide marker, a task item), depth 0 or 1: 1152 shapes. At depth 0 the lazy
 * line stands inside the item exactly where a paragraph line stands above it,
 * as commonmark.js and cmark-gfm read every one of them on the step zero; an
 * item opening with a blank line over anything but a paragraph line is left
 * out of that assertion, a case of its own that reads as on main (`- [ ]`
 * alone opens no task item there, and the item holds the text `[ ]`). Every
 * shape holds from the second save at the latest, as on main.
 */
describe('the sweep of a lazy line after a blank line (#758)', () => {
  const ITEMS: ReadonlyArray<readonly [string, string, number]> = [
    ['bullet', '- ', 2],
    ['ordered', '1. ', 3],
    ['wide marker', '10.  ', 5],
    ['task item', '- [ ] ', 2],
  ];
  const ABOVE: Record<string, (i: string) => string[]> = {
    'a paragraph line': (i) => [`${i}Two`],
    'a blank line': (i) => [`${i}Two`, ''],
    'indented code': (i) => [`${i}    code`],
    'an open fence': (i) => [`${i}\`\`\``, `${i}x`],
    'a closed fence': (i) => [`${i}\`\`\``, `${i}x`, `${i}\`\`\``],
    'a heading': (i) => [`${i}# h`],
    'a thematic break': (i) => [`${i}***`],
    'an HTML block': (i) => [`${i}<div>x</div>`],
    'a table row': (i) => [`${i}| a |`, `${i}| - |`, `${i}| b |`],
  };
  const POSITIONS = [
    'after a blank line and a paragraph line',
    'in an item opening with a blank line',
    'under a quote in the item',
    'in a nested item',
  ];
  const FOLLOWS = ['an item', 'a fence indented to the item', 'a paragraph', 'the end'];
  const shapes = ITEMS.flatMap(([item, marker, col]) =>
    Object.entries(ABOVE).flatMap(([above, lines]) =>
      POSITIONS.flatMap((position) =>
        FOLLOWS.flatMap((follows) =>
          [0, 1].map((depth) => {
            const P = depth ? '  ' : '';
            const I = P + ' '.repeat(col);
            const out: string[] = depth ? ['- outer', ''] : [];
            if (position === 'in an item opening with a blank line') {
              out.push(`${P}${marker.trimEnd()}`, ...lines(I));
            } else if (position === 'under a quote in the item') {
              out.push(`${P}${marker}One`, '', ...lines('').map((l) => `${I}> ${l}`.trimEnd()));
            } else if (position === 'in a nested item') {
              out.push(`${P}${marker}One`, '', `${I}- inner`, '', ...lines(`${I}  `));
            } else {
              out.push(`${P}${marker}One`, '', ...lines(I));
            }
            out.push(`${P}lazy.`);
            if (follows === 'an item') out.push(`${P}${marker}Three`);
            if (follows === 'a fence indented to the item')
              out.push('', `${I}\`\`\``, `${I}y`, `${I}\`\`\``);
            if (follows === 'a paragraph') out.push('', `${P}after`);
            return {
              name: `${item}, ${above}, ${position}, followed by ${follows}, depth ${depth}`,
              source: `${out.join('\n')}\n`,
              above,
              position,
              depth,
            };
          }),
        ),
      ),
    ),
  );

  it('counts 1152 shapes', () => {
    expect(shapes).toHaveLength(1152);
  });

  it.each(shapes)('$name', { timeout: 20000 }, async ({ source, above, position, depth }) => {
    const ownCase =
      position === 'in an item opening with a blank line' && above !== 'a paragraph line';
    if (depth === 0 && !ownCase) {
      const html = markdownToHtml(source, { keepRawHtml: false });
      const before = html.slice(0, html.indexOf('lazy.'));
      const inside = (before.match(/<li\b/g) ?? []).length > (before.match(/<\/li>/g) ?? []).length;
      expect(inside).toBe(above === 'a paragraph line');
    }
    const first = await openAndSaveUnedited(source);
    const second = await openAndSaveUnedited(first);
    expect(await openAndSaveUnedited(second)).toBe(second);
  });
});
