import { Slice } from '@tiptap/pm/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { countDocument } from '../ui/statusbar';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * A line break inside a paragraph, carried from the file to the file (#571,
 * route A of the step zero, owner decision on #571). The pins of the
 * unedited save at both levels are in `soft-break.test.ts` and
 * `markdown/roundtrip.test.ts`; this file holds the rest of what the decision
 * named: the shapes, the edits beside a break, the search, the clipboard and
 * the counts.
 *
 * **What this harness cannot see**: happy-dom runs no `contenteditable`, so
 * the caret over the break and a native Backspace in WebView2 are not
 * observable here. A Backspace or a Delete below is the deletion of the one
 * position the break takes, which is what ProseMirror makes of either key
 * beside an atom; the keystroke itself is on the manual pass of the pull
 * request.
 */

const DOCUMENT_PATH = '/doc/notes.md';

function recordingIO(disk: Map<string, string>): PlatformIO {
  return {
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

let instances: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.innerHTML = '';
});

/** Open `text` as a file, change nothing, save, and return what reached the disk. */
async function openAndSaveUnedited(text: string): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);
  const editor = editorWith(loaded.document.markdownBody);
  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;
  const result = await saveMarkdown(buildDocument(state, editor.getMarkdown), io);
  return result.writtenText;
}

function paste(instance: EditorInstance, clipboard: { text?: string; html?: string }): void {
  const data: Record<string, string> = {};
  if (clipboard.text !== undefined) data['text/plain'] = clipboard.text;
  if (clipboard.html !== undefined) data['text/html'] = clipboard.html;
  const event = {
    clipboardData: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
      files: [],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = instance.editor;
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

/** The node types of the first paragraph of the document, in order. */
function firstParagraph(instance: EditorInstance): string[] {
  const types: string[] = [];
  instance.editor.state.doc.firstChild?.forEach((node) => {
    types.push(node.isText ? `text:${node.text}` : node.type.name);
  });
  return types;
}

const WRAPPED = 'one two\nthree four';
/** The position after `one two`, where the break of `WRAPPED` stands. */
const BREAK = 8;

describe('an unedited save keeps every wrap the file wrote (#571)', () => {
  it.each([
    ['a paragraph wrapped over three lines', 'one two\nthree four\nfive six\n'],
    ['a bullet item', '- one two\n  three four\n'],
    ['an ordered item', '1. one two\n   three four\n'],
    ['an item past nine', '10. one two\n    three four\n'],
    ['an item continued deeper than its marker', '- one two\n    three four\n'],
    ['a nested item', '- a\n  - one two\n    three four\n'],
    ['the second paragraph of an item', '- a\n\n  one two\n  three four\n'],
    ['a quote', '> one two\n> three four\n'],
    ['a nested quote', '> > one two\n> > three four\n'],
    ['an item in a quote', '> - one two\n>   three four\n'],
    ['a continuation indented by three', 'one two\n   three four\n'],
    // `marked` reports four fewer past four in an item; the four are written back.
    ['an item continued eight past its marker', '- one two\n          three four\n'],
    ['a space before the break', 'one two \nthree four\n'],
    ['a link across the break', 'one [two\nthree](https://e.com) four\n'],
    ['emphasis across the break', 'one *two\nthree* four\n'],
    ['a wrapped item of a task list', '- [ ] one two\n  three four\n'],
    ['a wrapped footnote definition', 'Text[^1].\n\n[^1]: one two\n    three four\n'],
    ['a CRLF paragraph', 'one two\r\nthree four\r\n'],
    ['a CRLF list item', '- one two\r\n  three four\r\n'],
  ])('%s', async (_label, file) => {
    const saved = await openAndSaveUnedited(file);
    expect(saved).toBe(file);
    expect(await openAndSaveUnedited(saved)).toBe(saved);
  });

  it('holds the break as one node between the two lines', () => {
    expect(firstParagraph(editorWith(WRAPPED))).toEqual([
      'text:one two',
      'softBreak',
      'text:three four',
    ]);
  });
});

describe('what an unedited save still writes another way, recorded under R-C2 (#571)', () => {
  it.each([
    // Known exception — a lazy continuation line is written with the marker of its container.
    ['a lazy line in a quote', '> one two\nthree four\n', '> one two\n> three four\n'],
    ['a lazy line in an item', '- one two\nthree four\n', '- one two\n  three four\n'],
    // Known exception — soft line breaks become spaces: the code span, upstream.
    ['a code span across the break', 'one `two\nthree` four\n', 'one `two three` four\n'],
    // The same exception, a heading: item 1 of the decision.
    ['a setext heading over two lines', 'one two\nthree four\n===\n', '# one two three four\n'],
    // Known exception — an escape the file did not have: a wrapped line is a text node start.
    ['a wrapped line opening with a number', 'see\n2. three four\n', 'see\n2\\. three four\n'],
    ['a wrapped line opening with a hyphen', 'one\n-x four\n', 'one\n\\-x four\n'],
    // The same exception as the lazy line: an item continued four to seven past
    // its marker is read with the four taken, which cannot be told from none.
    [
      'an item continued four past its marker',
      '- one two\n      three four\n',
      '- one two\n  three four\n',
    ],
    // A mark ending on the break is closed before it, as at a space.
    [
      'emphasis ending on the break',
      'one *two\n[three](https://e.com)*\n',
      'one *two*\n[*three*](https://e.com)\n',
    ],
    // A break beside a hard break is not written: the hard break ends the line.
    ['a raw br on a line of its own', 'one\n<br>\ntwo\n', 'one  \ntwo\n'],
  ])('%s', async (_label, file, written) => {
    const saved = await openAndSaveUnedited(file);
    expect(saved).toBe(written);
    expect(await openAndSaveUnedited(saved)).toBe(saved);
  });
});

describe('a soft break in a block that holds one line is written as a space (#571, item 1)', () => {
  it('turned into a heading, the paragraph is written on one line', () => {
    const editor = editorWith(WRAPPED);
    editor.editor.chain().setTextSelection(3).toggleHeading({ level: 2 }).run();
    expect(editor.getMarkdown()).toBe('## one two three four');
  });

  it('pasted into a table cell, it is written as a space and the row holds', () => {
    const editor = editorWith('| a | b |\n| --- | --- |\n| x | y |');
    let cell = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'x') cell = pos;
    });
    // Built in this editor's schema: each editor has a schema of its own.
    const { schema } = editor.editor;
    const content = [
      schema.text('one two'),
      schema.nodes.softBreak.create(),
      schema.text('three four'),
    ];
    editor.editor.view.dispatch(editor.editor.state.tr.replaceWith(cell, cell + 1, content));
    expect(editor.getMarkdown()).toBe('| a | b |\n| --- | --- |\n| one two three four | y |');
  });
});

describe('editing beside a break (#571)', () => {
  it.each<[string, (instance: EditorInstance) => void, string]>([
    [
      'typing just before the break',
      (e) => e.editor.chain().setTextSelection(BREAK).insertContent('X').run(),
      'one twoX\nthree four',
    ],
    [
      'typing just after the break',
      (e) =>
        e.editor
          .chain()
          .setTextSelection(BREAK + 1)
          .insertContent('X')
          .run(),
      'one two\nXthree four',
    ],
    [
      'Backspace after the break: the two words join',
      (e) => e.editor.view.dispatch(e.editor.state.tr.delete(BREAK, BREAK + 1)),
      'one twothree four',
    ],
    [
      'selecting across the break and deleting',
      (e) => e.editor.chain().setTextSelection({ from: 6, to: 12 }).deleteSelection().run(),
      'one tee four',
    ],
    [
      'typing then undo gives the file back',
      (e) => {
        e.editor.chain().setTextSelection(3).insertContent('X').run();
        e.editor.commands.undo();
      },
      'one two\nthree four',
    ],
  ])('%s', (_label, edit, written) => {
    const editor = editorWith(WRAPPED);
    edit(editor);
    expect(editor.getMarkdown()).toBe(written);
  });

  it('typing in the first of three lines keeps every wrap, the line longer', () => {
    const editor = editorWith('one two\nthree four\nfive six');
    editor.editor.chain().setTextSelection(3).insertContent('XYZ').run();
    expect(editor.getMarkdown()).toBe('onXYZe two\nthree four\nfive six');
  });

  it.each([
    ['before', BREAK],
    ['after', BREAK + 1],
  ])('Enter %s the break leaves no break at the edge of either paragraph (item 3)', (_l, at) => {
    const editor = editorWith(WRAPPED);
    editor.editor.chain().setTextSelection(at).splitBlock().run();
    const blocks: string[][] = [];
    editor.editor.state.doc.forEach((block) => {
      const types: string[] = [];
      block.forEach((node) => {
        types.push(node.isText ? `text:${node.text}` : node.type.name);
      });
      blocks.push(types);
    });
    expect(blocks).toEqual([['text:one two'], ['text:three four']]);
    expect(editor.getMarkdown()).toBe('one two\n\nthree four');
    // One undo takes the Enter back, the removed break with it.
    editor.editor.commands.undo();
    expect(editor.getMarkdown()).toBe(WRAPPED);
  });
});

describe('search reads the break as a space (#571, item 4)', () => {
  type SearchStorage = { results: { from: number; to: number }[]; resultIndex: number };
  const storage = (e: EditorInstance) => e.editor.storage.searchAndReplace as SearchStorage;

  it('finds two words on either side of a break, over the break', () => {
    const editor = editorWith(WRAPPED);
    editor.editor.commands.setSearchTerm('two three');
    expect(storage(editor).results).toEqual([{ from: 5, to: 14 }]);
  });

  it('replaces across a break, the break going with the match', () => {
    const editor = editorWith(WRAPPED);
    editor.editor.commands.setSearchTerm('two three');
    editor.editor.commands.setReplaceTerm('2 3');
    editor.editor.commands.replace();
    expect(editor.getMarkdown()).toBe('one 2 3 four');
  });

  it('replaces every match, the others keeping their breaks', () => {
    const editor = editorWith('a b\nc d\na b\nc d');
    editor.editor.commands.setSearchTerm('b c');
    editor.editor.commands.setReplaceTerm('B');
    editor.editor.commands.replaceAll();
    expect(editor.getMarkdown()).toBe('a B d\na B d');
  });

  it('steps to the next match across breaks, as F3 does', () => {
    const editor = editorWith('a b\nc d\na b\nc d');
    editor.editor.commands.setSearchTerm('b c');
    expect(storage(editor).results).toHaveLength(2);
    editor.editor.commands.nextSearchResult();
    expect(storage(editor).resultIndex).toBe(1);
  });
});

describe('the clipboard (#571)', () => {
  it('a copy of a wrapped paragraph puts the words with a space on the plain text', () => {
    const editor = editorWith(WRAPPED);
    const { view, state } = editor.editor;
    const copied = view.serializeForClipboard(new Slice(state.doc.content, 0, 0));
    expect(copied.text).toBe('one two three four');
  });

  it('a copy and paste inside AgentEd keeps the break', () => {
    const editor = editorWith(WRAPPED);
    const { view, state } = editor.editor;
    const copied = view.serializeForClipboard(
      state.doc.slice(1, state.doc.firstChild?.nodeSize ?? 1),
    );
    const target = editorWith('start');
    // A copy from this window carries its token, and the paste plugin hands
    // it to ProseMirror's own route, which `pasteHTML` takes.
    target.editor.view.pasteHTML(copied.dom.innerHTML);
    expect(target.getMarkdown()).toBe('startone two\nthree four');
  });

  it('a rich paste from a page whose source has a newline inside a paragraph makes no break', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, { html: '<p>one two\nthree four</p>', text: 'one two three four' });
    let breaks = 0;
    editor.editor.state.doc.descendants((node) => {
      if (node.type.name === 'softBreak') breaks += 1;
    });
    expect(breaks).toBe(0);
    expect(editor.getMarkdown()).not.toContain('\n');
  });

  it('a plain-text paste still reads a single newline as a hard break (R-C13)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(6);
    paste(editor, { text: 'alpha\nbeta' });
    expect(firstParagraph(editor)).toEqual(['text:startalpha', 'hardBreak', 'text:beta']);
  });
});

describe('what the break must not change (#571, the regression half)', () => {
  it.each([
    ['two spaces', 'one two  \nthree four', 'one two  \nthree four'],
    // Known exception — backslash hard breaks: unchanged by #571.
    ['a backslash', 'one two\\\nthree four', 'one two  \nthree four'],
  ])('a hard break spelled with %s stays a hard break', (_l, file, written) => {
    const editor = editorWith(file);
    expect(firstParagraph(editor)).toEqual(['text:one two', 'hardBreak', 'text:three four']);
    expect(editor.getMarkdown()).toBe(written);
  });

  it('words and tokens read the break as a space', () => {
    const editor = editorWith(WRAPPED);
    expect(editor.editor.state.doc.textContent).toBe('one two three four');
    expect(countDocument(editor.editor.state.doc.textContent)).toEqual(
      countDocument('one two three four'),
    );
  });
});
