/**
 * An HTML block that wraps an image, or text, keeps its wrapper through an
 * untouched save (#468, owner decision of 2026-10-02 on #468).
 *
 * A centred image is spelled on GitHub with a raw HTML block around it, a `p`
 * or a `div` with `align`, and AgentEd wrote the image back alone: the schema
 * has no node for the wrapper, so ProseMirror lifted its content out, and the
 * serializer never saw it. Measured on the #468 step zero through the editor in
 * Chromium, the five shapes of the issue and 96 more, every one losing the
 * wrapper and nothing else.
 *
 * The repair is the route #283 gives a raw table: the wrapper bytes ride on the
 * paragraph its content becomes, which is drawn as before, and an unedited
 * paragraph is written back as those bytes, decided at save by reading them
 * again. An edit inside the block lets the wrapper go, as it went before
 * (option i of the decision).
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

const IMG = '<img src="https://example.com/a.png" alt="pic" width="200">';
const around = (shape: string) => `x\n\n${shape}\n\ny\n`;

/** The five shapes of #468, in its order. */
const FIVE: ReadonlyArray<readonly [string, string]> = [
  ['a centred p, the image on its own indented line', around(`<p align="center">\n  ${IMG}\n</p>`)],
  ['a centred p on one line', around(`<p align="center">${IMG}</p>`)],
  ['a centred div on three lines', around(`<div align="center">\n  ${IMG}\n</div>`)],
  ['a centred div on one line', around(`<div align="center">${IMG}</div>`)],
  [
    'a centred div, a blank line, a markdown image, a blank line, the end tag',
    around('<div align="center">\n\n![pic](https://example.com/a.png)\n\n</div>'),
  ],
];

const WRAPPERS: ReadonlyArray<readonly [string, string, string]> = [
  ['a centred p', '<p align="center">', '</p>'],
  ['a plain p', '<p>', '</p>'],
  ['a centred div', '<div align="center">', '</div>'],
  ['a plain div', '<div>', '</div>'],
  ['center', '<center>', '</center>'],
  ['a link', '<a href="https://example.com">', '</a>'],
  ['picture', '<picture><source srcset="https://example.com/b.png">', '</picture>'],
  ['details', '<details><summary>More</summary>', '</details>'],
];

const CONTENTS: ReadonlyArray<readonly [string, string]> = [
  ['an HTML image', IMG],
  ['a markdown image', '![pic](https://example.com/a.png)'],
  ['text', 'Some text'],
  ['markdown text', 'Some **bold** and [link](https://example.com)'],
];

const LAYOUTS: ReadonlyArray<
  readonly [string, (open: string, inner: string, close: string) => string]
> = [
  ['one line', (o, inner, c) => `${o}${inner}${c}`],
  ['three lines', (o, inner, c) => `${o}\n  ${inner}\n${c}`],
  ['blank lines inside', (o, inner, c) => `${o}\n\n${inner}\n\n${c}`],
];

/** The breadth of the #468 step zero: every wrapper, around every content, in every layout. */
const BREADTH = WRAPPERS.flatMap(([wrapper, open, close]) =>
  CONTENTS.flatMap(([content, inner]) =>
    LAYOUTS.map(
      ([layout, make]) =>
        [`${wrapper} around ${content}, ${layout}`, around(make(open, inner, close))] as const,
    ),
  ),
);

/**
 * The eight the route does not reach, recorded in REQUIREMENTS: a `picture` or
 * a `details` with blank lines inside, whose start tag shares its line with a
 * second tag, so the wrapper is not one start tag alone and nothing joins it.
 * Each keeps the loss it had, written back as below, and holds still.
 */
const NOT_REACHED: Readonly<Record<string, string>> = {
  'picture around an HTML image, blank lines inside': around(IMG),
  'picture around a markdown image, blank lines inside': around(
    '![pic](https://example.com/a.png)',
  ),
  'picture around text, blank lines inside': around('Some text'),
  'picture around markdown text, blank lines inside': around(
    'Some **bold** and [link](https://example.com)',
  ),
  'details around an HTML image, blank lines inside': around(`More ${IMG}`),
  'details around a markdown image, blank lines inside': around(
    'More\n\n![pic](https://example.com/a.png)',
  ),
  'details around text, blank lines inside': around('More\n\nSome text'),
  'details around markdown text, blank lines inside': around(
    'More\n\nSome **bold** and [link](https://example.com)',
  ),
};

describe('an HTML block wrapping an image or text keeps its wrapper (#468)', () => {
  it.each(FIVE)('%s', async (_label, file) => {
    const once = await openAndSaveUnedited(file);
    expect(once).toBe(file);
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it.each(BREADTH.filter(([label]) => !(label in NOT_REACHED)))('%s', async (_label, file) => {
    const once = await openAndSaveUnedited(file);
    expect(once).toBe(file);
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it.each(
    Object.entries(NOT_REACHED),
  )('%s keeps the loss it had, recorded, and holds still', async (label, written) => {
    const file = BREADTH.find(([name]) => name === label)?.[1] ?? '';
    const once = await openAndSaveUnedited(file);
    expect(once).toBe(written);
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it.each([
    ['in a blockquote', `x\n\n> <div align="center">${IMG}</div>\n\ny\n`],
    ['in a list item', `x\n\n- <div align="center">${IMG}</div>\n\ny\n`],
  ])('the same, %s', async (_label, file) => {
    expect(await openAndSaveUnedited(file)).toBe(file);
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

describe('what the person sees and what an edit does (#468)', () => {
  it('the wrapped image is drawn as an image, as before', () => {
    const { editor, done } = editorWith(FIVE[2][1]);
    const names: string[] = [];
    editor.editor.state.doc.descendants((node) => {
      names.push(node.type.name);
    });
    expect(names).toContain('image');
    done();
  });

  it('an edit inside the block lets the wrapper go, as it went before (option i)', () => {
    const { editor, done } = editorWith(around(`<div align="center">${IMG} caption</div>`));
    let end = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes('caption')) end = pos + node.text.length;
    });
    editor.editor.chain().setTextSelection(end).insertContent('!').run();
    expect(editor.getMarkdown()).toBe(`x\n\n${IMG} caption!\n\ny`);
    done();
  });

  it('an edit undone gives the wrapper back', () => {
    const file = around(`<div align="center">${IMG} caption</div>`);
    const { editor, done } = editorWith(file);
    let end = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes('caption')) end = pos + node.text.length;
    });
    editor.editor.chain().setTextSelection(end).insertContent('!').run();
    editor.editor.commands.undo();
    expect(`${editor.getMarkdown()}\n`).toBe(file);
    done();
  });
});
