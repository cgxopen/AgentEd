/**
 * A blank line inside an attribute value of raw HTML loses the rest of the
 * document on an untouched save (R-C2 known exception, #20).
 *
 * CommonMark ends an HTML block at a blank line, so `<p title="one` followed
 * by a blank line is a block whose attribute value is still open. `marked`
 * renders what follows as markdown, where every double quote is written
 * `&quot;`, and the HTML parser then reads all of it as that attribute value,
 * up to the next raw double quote or the end of the document; an element
 * whose attribute never closes is dropped. So the cut happens while the file
 * is being read, the editor already holds the shorter document when it
 * opens, and the save writes what it holds. Measured on `7a3d3e6`, and the
 * same cut was read off headless Chromium parsing the HTML `marked` writes,
 * so it is the HTML parser and not DOMPurify that drops it.
 */
import { marked } from 'marked';
import { describe, expect, it } from 'vitest';
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

const AROUND =
  '# Notes\n\nBefore.\n\n<p title="one\n\ntwo">inside</p>\n\nAfter.\n\n## Next\n\n- item\n\nLast "quoted" words.\n';

/** [label, the file, what an untouched save writes] - bytes in the labels. */
const ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['the shape alone, 24 bytes to 0', '<p title="\n\nkeep">a</p>\n', ''],
  ['a list element, 45 bytes to 0', '<ul title="\n\nkeep"><li>a</li><li>b</li></ul>\n', ''],
  ['with a document around it, 96 bytes to 17', AROUND, '# Notes\n\nBefore.\n'],
  [
    'a block element other than a paragraph, 57 bytes to 17',
    '# Notes\n\nBefore.\n\n<div class="x\n\ny">inside</div>\n\nAfter.\n',
    '# Notes\n\nBefore.\n',
  ],
  [
    'an attribute in single quotes, 48 bytes to 8',
    "Before.\n\n<p title='one\n\ntwo'>inside</p>\n\nAfter.\n",
    'Before.\n',
  ],
  [
    'a later raw double quote ends the loss there, 90 bytes to 27',
    'Before.\n\n<p title="one\n\ntwo">inside</p>\n\nAfter.\n\n<span class="k">kept?</span> tail\n\nLast.\n',
    'Before.\n\nkept? tail\n\nLast.\n',
  ],
  [
    'inside a list item, the items after it go too, 46 bytes to 4',
    '- a\n- <p title="one\n\n  two">x</p>\n- c\n\nAfter.\n',
    '- a\n',
  ],
  ['inside a blockquote, 39 bytes to 0', '> <p title="one\n>\n> two">x</p>\n\nAfter.\n', ''],
];

describe('a blank line inside a raw HTML attribute value (R-C2, #20)', () => {
  it.each(ROWS)('%s', async (_label, file, written) => {
    expect(await openAndSaveUnedited(file)).toBe(written);
  });

  it.each(ROWS)('%s - and the second save moves nothing', async (_label, file) => {
    const once = await openAndSaveUnedited(file);
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it('is cut while the file is read: the block ends at the blank line and the parse stops there', () => {
    const html = marked.lexer(AROUND).find((token) => token.type === 'html');
    expect(html?.raw).toBe('<p title="one\n\n');
    expect(markdownToHtml(AROUND)).not.toMatch(/inside|After|Next|item|Last/);
  });

  it('leaves the same attribute value alone without the blank line', async () => {
    // The control: a value that spans one line break, not a blank line, is
    // no part of this. The element itself is written as markdown, which is
    // the exception for raw HTML that is not one whole table (#283).
    const file = 'Before.\n\n<p title="one\ntwo">inside</p>\n\nAfter.\n';
    expect(await openAndSaveUnedited(file)).toBe('Before.\n\ninside\n\nAfter.\n');
  });
});
