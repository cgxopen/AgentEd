/**
 * A raw HTML block that ends inside an attribute value or a comment is
 * refused at open (#455), where it used to cut the rest of the document.
 *
 * CommonMark ends an HTML block at a blank line, so `<p title="one` followed
 * by a blank line is a block whose attribute value is still open. `marked`
 * renders what follows as markdown, where every double quote is written
 * `&quot;`, and the HTML parser reads all of it as that attribute value, up to
 * the next raw double quote or the end of the document, and drops the element.
 * An unclosed `<!--` inside a container does the same to everything after the
 * container. Measured on #453 and #455: the editor opened on the shorter
 * document, nothing said so, and a save wrote it over the file.
 *
 * Refused as a file that is not UTF-8 is refused (R-C3), owner decision of
 * 2026-10-01 on #455: at read, before the open changes any state, with a
 * message naming the line where the cut begins. The eight fixtures of #453
 * are refused; the thirteen controls of the #455 scan open.
 */
import { marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '../editor/markdown/parse';
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

const AROUND =
  '# Notes\n\nBefore.\n\n<p title="one\n\ntwo">inside</p>\n\nAfter.\n\n## Next\n\n- item\n\nLast "quoted" words.\n';

/** [label, the file, the line the message names] - the eight fixtures of #453. */
const REFUSED: ReadonlyArray<readonly [string, string, number]> = [
  ['the shape alone', '<p title="\n\nkeep">a</p>\n', 1],
  ['a list element', '<ul title="\n\nkeep"><li>a</li><li>b</li></ul>\n', 1],
  ['with a document around it', AROUND, 5],
  [
    'a block element other than a paragraph',
    '# Notes\n\nBefore.\n\n<div class="x\n\ny">inside</div>\n\nAfter.\n',
    5,
  ],
  ['an attribute in single quotes', "Before.\n\n<p title='one\n\ntwo'>inside</p>\n\nAfter.\n", 3],
  [
    'a later raw double quote that ends the loss there',
    'Before.\n\n<p title="one\n\ntwo">inside</p>\n\nAfter.\n\n<span class="k">kept?</span> tail\n\nLast.\n',
    3,
  ],
  ['inside a list item', '- a\n- <p title="one\n\n  two">x</p>\n- c\n\nAfter.\n', 2],
  ['inside a blockquote', '> <p title="one\n>\n> two">x</p>\n\nAfter.\n', 1],
  ['the control of the #457 review', '<div title="a\n\nb">x</div>\n\nafter\n', 1],
];

/**
 * The words a tag swallows as attribute names (#457 review): `marked` keeps
 * `<div`, a blank line and `some text` in one block, and the parser reads the
 * words as attributes of the `div`. Measured in this pipeline: saved as
 * `after` alone, the words gone.
 */
const REFUSED_TAG: ReadonlyArray<readonly [string, string, number]> = [
  ['words inside a tag after a blank line', '<div\n\nsome text\n\nafter\n', 1],
  ['the same below a paragraph', 'Before.\n\n<div\n\nsome text\n\nafter\n', 3],
];

/** The same class with a comment rather than an attribute (#455). */
const REFUSED_COMMENTS: ReadonlyArray<readonly [string, string, number]> = [
  ['an unclosed comment inside a blockquote', '> <!-- never closed\n\nAfter.\n', 1],
  ['an unclosed comment inside a list item', 'Intro.\n\n- <!-- never closed\n\nAfter.\n', 3],
];

/** The thirteen controls of the #455 scan, and the control of #453. */
const OPENS: ReadonlyArray<readonly [string, string]> = [
  ['the attribute at the very end, nothing after it', 'Before.\n\n<p title="one\n\n'],
  [
    'an unclosed comment at the top level, which runs to the end',
    'Before.\n\n<!-- never closed\n\nAfter.\n',
  ],
  [
    'a style and a script block (R-C2)',
    '# Notes\n\n<style>\np { color: red }\n</style>\n\nBetween.\n\n<script>\nalert(1)\n</script>\n\nThe end.\n',
  ],
  ['a closed comment', 'one <!-- note --> two\n\n<!-- alone -->\n\nAfter.\n'],
  ['a closed comment holding a quote', '<!-- say "x -->\n\nAfter.\n'],
  // An unclosed style left open at the top level opened here until #458, which
  // refuses it by owner decision: its text runs past the blank line and takes
  // `After.` with it, measured in Chromium. It is a row of
  // `raw-text-left-open.test.ts` now; a style left open on the last lines of
  // the file, which takes only its own text, still opens there.
  ['a table inside a div (R-C2)', '<div><table><tr><td>a</td></tr></table></div>\n\nAfter.\n'],
  ['a raw table with a blank line (R-C2)', '<table>\n<tr><td>a</td></tr>\n\n</table>\n\nAfter.\n'],
  ['a value spanning one line break', 'Before.\n\n<p title="one\ntwo">inside</p>\n\nAfter.\n'],
  ['an html image', '<img src="a.png" alt="x" width="9">\n\nAfter.\n'],
  ['a tag left open with no quote', 'Before.\n\n<div class="x"\n\nAfter.\n'],
  ['an apostrophe in html text', "<p>it's fine</p>\n\nAfter.\n"],
  ['a quote in html text', '<div>say "hi</div>\n\nAfter.\n'],
  ['the same attribute value with no blank line (#453)', 'Before.\n\n<p title="one\ntwo">x</p>\n'],
  // The three false refusals of the #457 review, each measured to open whole
  // in Chromium: a quote inside an unquoted value, a quote inside an unquoted
  // value after other characters, and quotes in the text of a script.
  ['an apostrophe in an unquoted value', "<p title=don't>hello</p>\n\nafter\n"],
  ['a quote inside an unquoted value', '<p class=a"b>hello</p>\n\nafter\n'],
  // Text that would open a value, were the script read as markup: only the
  // raw-text rule keeps this one open.
  [
    'a tag spelled in the text of a script (R-C2)',
    "<script>\nconst t = '<p title=\"';\n</script>\n\nafter\n",
  ],
  [
    'quotes in the text of a script (R-C2)',
    '<script>\nif (a<b) s = "x";\n// don\'t\n</script>\n\nafter\n',
  ],
];

describe('a raw HTML block that would cut the document is refused at open (#455)', () => {
  it.each([...REFUSED, ...REFUSED_TAG, ...REFUSED_COMMENTS])('%s', async (_label, file, line) => {
    const refused = await refusalOf(file);
    expect(refused).toBeInstanceOf(Error);
    const message = openFailedMessage(PATH, refused);
    expect(message).toContain(`at line ${line} `);
    expect(message).toContain('Nothing has changed on disk.');
    expect(message.endsWith(PATH)).toBe(true);
  });

  it.each(OPENS)('%s opens', async (_label, file) => {
    expect(await refusalOf(file)).toBeNull();
  });

  it('names the repair for each kind', async () => {
    expect(openFailedMessage(PATH, await refusalOf(AROUND))).toContain(
      'Remove the blank line inside that tag',
    );
    expect(openFailedMessage(PATH, await refusalOf(REFUSED_COMMENTS[0][1]))).toContain(
      'Close that comment with -->',
    );
  });

  it('counts the line in the file, metadata block and Windows line endings included', async () => {
    const file = '---\ntitle: x\n---\n\nBefore.\n\n<p title="one\n\ntwo">x</p>\n\nAfter.\n';
    expect(openFailedMessage(PATH, await refusalOf(file))).toContain('at line 7 ');
    expect(openFailedMessage(PATH, await refusalOf(file.replace(/\n/g, '\r\n')))).toContain(
      'at line 7 ',
    );
  });

  it('is what the editor would have done: the block ends at the blank line and the parse stops there', () => {
    // The cause, kept as the reason for the refusal: were the file opened,
    // this is the document the editor would hold.
    const html = marked.lexer(AROUND).find((token) => token.type === 'html');
    expect(html?.raw).toBe('<p title="one\n\n');
    expect(markdownToHtml(AROUND)).not.toMatch(/inside|After|Next|item|Last/);
  });
});
