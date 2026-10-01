/**
 * A raw-text element left open with text after it is refused at open (#458).
 *
 * The text of `script`, `style`, `title`, `xmp`, `iframe`, `noembed` and
 * `noframes` is not markup until its end tag, and nothing ends `plaintext`.
 * Left open inside a container, the HTML block ends with the container and the
 * parser reads everything after it as the text of that element; at the top
 * level `title` and the others end at a blank line with the same result, and
 * `script` and `style` run to the end of the file. Measured on `ed3e978` in
 * Chromium, through the editor itself: each saves the paragraph before it and
 * nothing after. The test harness disagrees there, so these rows assert the
 * refusal, which reads the tokens, rather than what a parser makes of them.
 *
 * Owner decision of 2026-10-01 on #458: refused as #455 refuses, at the line
 * where the element begins, with a repair naming the missing end tag.
 */
import { describe, expect, it } from 'vitest';
import { loadMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { openFailedMessage } from './open-failure';

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

describe('a raw-text element left open with text after it is refused at open (#458)', () => {
  it.each(REFUSED)('%s', async (_label, file, line, endTag) => {
    const message = openFailedMessage(PATH, await refusalOf(file));
    expect(message).toContain(`at line ${line} `);
    expect(message).toContain(
      `Add the missing ${endTag} in a text editor, where that element should end, then open the file again.`,
    );
    expect(message).toContain('Nothing has changed on disk.');
  });

  it.each(PLAINTEXT)('%s', async (_label, file, line) => {
    const message = openFailedMessage(PATH, await refusalOf(file));
    expect(message).toContain(`at line ${line} `);
    expect(message).toContain(
      'Remove the <plaintext> tag in a text editor, then open the file again.',
    );
  });

  it.each(OPENS)('%s opens', async (_label, file) => {
    expect(await refusalOf(file)).toBeNull();
  });
});
