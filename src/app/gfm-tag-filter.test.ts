/**
 * The nine tag names of the GFM tag filter are read as text, as GitHub reads
 * them (#461, owner decisions of 2026-10-02 on #461 and #460).
 *
 * GFM writes the opening `<` of the start and end tags of `title`, `textarea`,
 * `style`, `xmp`, `iframe`, `noembed`, `noframes`, `script` and `plaintext` as
 * text, in raw HTML blocks and inline, in any case: the Disallowed Raw HTML
 * extension, measured with `gh api markdown`. `marked` does not, so AgentEd
 * read them as tags: one left open inside a paragraph cut everything after it,
 * a `textarea` left open in a container wrote tags as text (#460), and a
 * closed block was dropped with its text (#343).
 *
 * Inline, the tag is text and is written back as the text it is. As a block,
 * the block is shown as its text and written back as its own bytes while it is
 * untouched, decided at save as #283 decides for a raw table; an edit folds it
 * into a paragraph of that text. Measured on the step zero of #461 in
 * Chromium through the editor; with the filter no raw-text element reaches the
 * parser, so the test harness and Chromium agree on these shapes.
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

const NAMES = [
  'title',
  'textarea',
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'script',
  'plaintext',
];

const POSITIONS: ReadonlyArray<readonly [string, (line: string) => string, string]> = [
  ['the top level', (line) => line, ''],
  ['a blockquote', (line) => `> ${line}`, '> '],
  ['a list item', (line) => `- ${line}`, '  '],
  ['a task item', (line) => `- [ ] ${line}`, '      '],
  ['an ordered item', (line) => `1. ${line}`, '   '],
  ['a nested quote', (line) => `> > ${line}`, '> > '],
];

const SHAPES: ReadonlyArray<
  readonly [string, (name: string, wrap: (line: string) => string, more: string) => string]
> = [
  ['a closed block', (n, w, m) => `Before.\n\n${w(`<${n}>`)}\n${m}x = 1\n${m}</${n}>\n\nAfter.\n`],
  ['a block left open', (n, w, m) => `Before.\n\n${w(`<${n}>`)}\n${m}x = 1\n\nAfter.\n`],
  [
    'closed inside a paragraph',
    (n, w) => `Before.\n\n${w(`Words <${n}>x = 1</${n}> more.`)}\n\nAfter.\n`,
  ],
  ['left open inside a paragraph', (n, w) => `Before.\n\n${w(`Words <${n}>x = 1`)}\n\nAfter.\n`],
];

/** Every name, in every position of #459, in every shape: 216 files. */
const MATRIX = NAMES.flatMap((name) =>
  POSITIONS.flatMap(([where, wrap, more]) =>
    SHAPES.map(
      ([shape, make]) => [`${name}, ${shape}, in ${where}`, make(name, wrap, more)] as const,
    ),
  ),
);

describe('the nine names are read as text and written back as the file wrote them (#461)', () => {
  it.each(MATRIX)('%s', async (_label, file) => {
    const once = await openAndSaveUnedited(file);
    expect(once).toBe(file);
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it('in any case, and an end tag alone', async () => {
    const file = 'Words <TITLE>x and </Style> end.\n\nAfter.\n';
    expect(await openAndSaveUnedited(file)).toBe(file);
  });

  it('a name that only begins like one is not touched', async () => {
    // `<titlex>` is not one of the nine, so it is the raw HTML it always was.
    const file = 'Words <titlex>a</titlex> end.\n';
    expect(await openAndSaveUnedited(file)).toBe('Words a end.\n');
  });
});

/**
 * The shape of the real file of the #460 step zero: a placeholder written as
 * `<title>` in prose, with the document going on after it. On `258975c` that
 * file of 8772 bytes was written back as 3873, stopping at the placeholder.
 */
const PLACEHOLDER =
  '# Messages\n\n' +
  'It fires while the arguments stream, so show a skeleton (Preparing: <title>...) before the result lands.\n\n' +
  '## The host context\n\n' +
  '- the theme\n- the locale\n\n' +
  'The end of the document.\n';

describe('a placeholder written as a tag in prose (#460 step zero)', () => {
  it('opens whole and is written back byte for byte', async () => {
    expect(await openAndSaveUnedited(PLACEHOLDER)).toBe(PLACEHOLDER);
  });
});

/** Open `markdown`, return the editor holding it. */
function editorWith(markdown: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(markdown);
  return {
    editor,
    done: () => {
      editor.destroy();
      host.remove();
    },
  };
}

describe('what the person sees and types (#461)', () => {
  it('a block is shown as its text', () => {
    const { editor, done } = editorWith('Before.\n\n<style>\np { color: red }\n</style>\n\nAfter.');
    expect(editor.editor.state.doc.textContent).toContain('<style> p { color: red } </style>');
    done();
  });

  it.each([
    'Use <title> as a placeholder',
    'Close it with </style> later',
    'A <textarea> here',
  ])('typed text holding a tag reopens as the same text: %s', (typed) => {
    const { editor, done } = editorWith('Before.\n\nX\n\nAfter.');
    let at = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'X') at = pos;
    });
    editor.editor
      .chain()
      .setTextSelection({ from: at, to: at + 1 })
      .insertContent({ type: 'text', text: typed })
      .run();
    const saved = editor.getMarkdown();
    editor.setMarkdown(saved);
    expect(editor.editor.state.doc.textBetween(0, editor.editor.state.doc.content.size, '|')).toBe(
      `Before.|${typed}|After.`,
    );
    done();
  });

  it('an edit to a block folds it into a paragraph of its text, which then holds still', () => {
    const { editor, done } = editorWith('Before.\n\n<style>\np {}\n</style>\n\nAfter.');
    let end = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes('</style>')) end = pos + node.text.length;
    });
    editor.editor.chain().setTextSelection(end).insertContent('!').run();
    const saved = editor.getMarkdown();
    expect(saved).toBe('Before.\n\n<style> p {} </style>!\n\nAfter.');
    editor.setMarkdown(saved);
    expect(editor.getMarkdown()).toBe(saved);
    done();
  });
});

describe('what stays as it was (#461)', () => {
  it('a raw HTML table holding one of the nine keeps its bytes (#283)', async () => {
    const file = '<table>\n<tr><td>a<script>x()</script></td><td>b</td></tr>\n</table>\n\nAfter.\n';
    expect(await openAndSaveUnedited(file)).toBe(file);
  });

  it('and that table is still a table in the editor, its tag drawn as text in the cell', () => {
    // Bytes alone cannot tell: a table kept as a block of text would keep them
    // too. What the person sees is the table, as GitHub draws it.
    const { editor, done } = editorWith(
      '<table>\n<tr><td>a<script>x()</script></td><td>b</td></tr>\n</table>',
    );
    expect(editor.editor.state.doc.firstChild?.type.name).toBe('table');
    expect(editor.editor.state.doc.textContent).toContain('a<script>x()</script>');
    done();
  });

  it('a raw table whose cell holds a tag of the nine with an open quote still opens', async () => {
    // The quote is in the text of a tag GFM writes as text, so it opens nothing;
    // the check for a cut reads it that way too.
    const file = '<table>\n<tr><td><style title="x</td><td>b</td></tr>\n</table>\n\nAfter.\n';
    expect(await openAndSaveUnedited(file)).toBe(file);
  });

  it('a comment holding one of the nine keeps its bytes (#245)', async () => {
    const file = 'Before <!-- see <style> --> after.\n';
    expect(await openAndSaveUnedited(file)).toBe(file);
  });

  it('a noscript block, which is not one of the nine, is still dropped (#343)', async () => {
    expect(await openAndSaveUnedited('Before.\n\n<noscript>\nx\n</noscript>\n\nAfter.\n')).toBe(
      'Before.\n\nAfter.\n',
    );
  });
});
