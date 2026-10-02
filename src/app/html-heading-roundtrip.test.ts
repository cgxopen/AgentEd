/**
 * A heading spelled as HTML, or wrapped in a centring block, keeps its bytes
 * through an untouched save (#470, owner decision of 2026-10-03 on #470).
 *
 * GitHub centres a heading only through HTML: an `h1` to `h6` with `align`,
 * or a centred `div` around a markdown heading. Measured on the #470 step zero
 * in Chromium through the editor: the heading node carries its level and
 * nothing else, so a raw heading was written back as a markdown heading, its
 * alignment gone, and one holding an image, a `br` and text came back split,
 * its text leaving the heading on the next open. A wrapper around a markdown
 * heading with blank lines inside lost the wrapper.
 *
 * The route of #469, on the heading node: the bytes ride on the heading that
 * is drawn, and an unedited heading is written back as them, decided at save.
 * An edit lets the HTML go and writes the markdown heading, as before (option
 * i of the decision).
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

const IMG = '<img src="https://example.com/logo.png" alt="logo" width="120">';
const before = (shape: string) => `${shape}\n\nx\n`;

const CONTENTS: ReadonlyArray<readonly [string, string, string]> = [
  ['text', 'AgentEd', 'AgentEd'],
  ['an image', IMG, IMG],
  ['an image, a br and text', `${IMG}<br>AgentEd`, `${IMG}\n  <br>\n  AgentEd`],
];

/** The 72 raw headings of the #470 step zero. */
const RAW_HEADINGS = [1, 2, 3, 4, 5, 6].flatMap((level) =>
  (
    [
      ['centred', ' align="center"'],
      ['plain', ''],
    ] as const
  ).flatMap(([kind, attribute]) =>
    CONTENTS.flatMap(([content, one, across]) => [
      [
        `h${level} ${kind}, ${content}, one line`,
        before(`<h${level}${attribute}>${one}</h${level}>`),
      ] as const,
      [
        `h${level} ${kind}, ${content}, across lines`,
        before(`<h${level}${attribute}>\n  ${across}\n</h${level}>`),
      ] as const,
    ]),
  ),
);

/** A wrapper around a markdown heading with blank lines inside: shape 2 of #470. */
const WRAPPED: ReadonlyArray<readonly [string, string]> = [
  ['a centred div around a markdown h1', before('<div align="center">\n\n# AgentEd\n\n</div>')],
  ['a centred div around a markdown h2', before('<div align="center">\n\n## AgentEd\n\n</div>')],
  ['a plain div around a markdown h1', before('<div>\n\n# AgentEd\n\n</div>')],
  ['center around a markdown h1', before('<center>\n\n# AgentEd\n\n</center>')],
];

describe('a heading spelled as HTML keeps its bytes (#470)', () => {
  it.each([...RAW_HEADINGS, ...WRAPPED])('%s', async (_label, file) => {
    const once = await openAndSaveUnedited(file);
    expect(once).toBe(file);
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it.each([
    ['in a blockquote', `> <h1 align="center">AgentEd</h1>\n\nx\n`],
    ['in a list item', `- <h2 align="center">AgentEd</h2>\n\nx\n`],
  ])('the same, %s', async (_label, file) => {
    expect(await openAndSaveUnedited(file)).toBe(file);
  });

  it('a centred p around a markdown heading, which the browser splits, keeps the loss it had', async () => {
    // Not reached, recorded: the browser closes the `p` before the heading, so
    // an empty paragraph stands where the wrapper was and nothing joins it.
    const file = before('<p align="center">\n\n# AgentEd\n\n</p>');
    const once = await openAndSaveUnedited(file);
    expect(once).toBe(before('# AgentEd'));
    expect(await openAndSaveUnedited(once)).toBe(once);
  });
});

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

function typeAtTheEndOfTheFirstBlock(editor: ReturnType<typeof createEditor>): void {
  const first = editor.editor.state.doc.firstChild;
  editor.editor
    .chain()
    .setTextSelection((first?.nodeSize ?? 2) - 1)
    .insertContent('!')
    .run();
}

describe('what the person sees and what an edit does (#470)', () => {
  it('a raw heading is drawn as a heading of its level', () => {
    const { editor, done } = editorWith(before('<h2 align="center">AgentEd</h2>'));
    const first = editor.editor.state.doc.firstChild;
    expect(first?.type.name).toBe('heading');
    expect(first?.attrs.level).toBe(2);
    done();
  });

  it('an edit lets the HTML go and writes the markdown heading (option i)', () => {
    const { editor, done } = editorWith(before('<h1 align="center">AgentEd</h1>'));
    typeAtTheEndOfTheFirstBlock(editor);
    expect(editor.getMarkdown()).toBe('# AgentEd!\n\nx');
    done();
  });

  it('an edit undone gives the bytes back', () => {
    const file = before('<h1 align="center">AgentEd</h1>');
    const { editor, done } = editorWith(file);
    typeAtTheEndOfTheFirstBlock(editor);
    editor.editor.commands.undo();
    expect(`${editor.getMarkdown()}\n`).toBe(file);
    done();
  });

  it('an edit to a heading holding an image, a br and text still writes it split, recorded', () => {
    const { editor, done } = editorWith(before(`<h1 align="center">${IMG}<br>AgentEd</h1>`));
    typeAtTheEndOfTheFirstBlock(editor);
    expect(editor.getMarkdown()).toBe(`# ${IMG}  \nAgentEd!\n\nx`);
    done();
  });
});
