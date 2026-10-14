/**
 * Two blocks the file wrote one directly under the other (#568).
 *
 * Every row goes through the path a real open and save take. The pairs are
 * the ones the step zero found most often in the corpus, in the three places
 * a block can follow another: the top level, a quote and a list item. The
 * edits are the table of the step zero, one test each, and so are the two
 * paste rows: a paste carries no flag (owner decisions on #568).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { ADJACENT_BLOCK_TYPES } from './adjacent-blocks';
import { ADJACENT_ATTRIBUTE } from './markdown/adjacency';
import { markdownToHtml } from './markdown/parse';
import { cleanPastedHtml, type PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

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

let open: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  open.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of open) instance.destroy();
  open = [];
  document.body.innerHTML = '';
});

/** Open `text` as a file, change nothing, save, and return what reached the disk. */
async function openAndSaveUnedited(text: string): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);
  const instance = editorWith(loaded.document.markdownBody);
  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;
  const result = await saveMarkdown(buildDocument(state, instance.getMarkdown), io);
  return result.writtenText;
}

/** Where the n-th top-level block starts and ends, inside it. */
function blockStart(instance: EditorInstance, n: number): number {
  let position = 0;
  for (let i = 0; i < n; i++) position += instance.editor.state.doc.child(i).nodeSize;
  return position + 1;
}

function blockEnd(instance: EditorInstance, n: number): number {
  return blockStart(instance, n) + instance.editor.state.doc.child(n).content.size;
}

/** Fire a paste carrying the given clipboard contents. */
function paste(instance: EditorInstance, data: Record<string, string>): void {
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

describe('two blocks the file wrote adjacent stay adjacent (R-C2, #568)', () => {
  it.each([
    ['a heading over a paragraph', '# Head\nText.\n'],
    ['a paragraph over a list', 'Text.\n- item\n- item\n'],
    ['a paragraph over a fence', 'Text.\n```\ncode\n```\n'],
    ['a heading over a list', '## Head\n1. item\n'],
    ['a heading over a fence', '# Head\n```js\nx\n```\n'],
    ['a fence over a paragraph', '```\ncode\n```\nText.\n'],
    ['a heading over a quote', '# Head\n> quote\n'],
    ['a heading over a heading', '# One\n## Two\n'],
    ['a paragraph over a heading', 'Text.\n# Head\n'],
    ['a heading over a table', '# Head\n| a |\n| - |\n| b |\n'],
    [
      'a list, a quote and a table over a heading',
      '- item\n# A\n> quote\n# B\n| a |\n| - |\n# C\n',
    ],
    ['a quote over a list', '> quote\n- item\n'],
    ['a rule over a paragraph', '---\nText.\n'],
    ['a definition over a paragraph', '[a]: https://example.com\nText [a].\n'],
    ['a footnote definition over a paragraph', 'Text.[^1]\n\n[^1]: note\nAfter.\n'],
    ['a heading over raw HTML', '# Head\n<div align="center">x</div>\n'],
    ['inside a quote', '> # Head\n> Text.\n> - item\n'],
    ['inside a list item', '- Text.\n  ```\n  code\n  ```\n  More.\n'],
    ['blank lines elsewhere kept as they were', '# Head\nText.\n\n## Next\n\nOther.\n'],
  ])('%s: an unedited save writes the file back', async (_label, file) => {
    expect(await openAndSaveUnedited(file)).toBe(file);
  });

  it('every block type carries the flag, and nothing else does', () => {
    const instance = editorWith('# Head\nText.\n');
    const carrying = Object.values(instance.editor.schema.nodes)
      .filter((type) => 'adjacent' in (type.spec.attrs ?? {}))
      .map((type) => type.name);
    expect(carrying.sort()).toEqual([...ADJACENT_BLOCK_TYPES].sort());
  });

  it('the attribute never reaches a file', async () => {
    const written = await openAndSaveUnedited('# Head\nText.\n- item\n');
    expect(written).not.toContain(ADJACENT_ATTRIBUTE);
  });
});

describe('a pair written adjacent only where it reads back (#568)', () => {
  it.each([
    ['`***`', 'Text.\n***\nAfter.\n', 'Text.\n\n---\nAfter.\n'],
    ['`* * *`, example 105', 'Foo\nbar\n* * *\nbaz\n', 'Foo\nbar\n\n---\nbaz\n'],
    ['`___`', 'Text.\n___\n', 'Text.\n\n---\n'],
    ['`--- -`, example 88', 'Foo\n--- -\n', 'Foo\n\n---\n'],
  ])(
    'a paragraph over a rule spelled %s keeps its blank line, and stays a paragraph',
    async (_label, file, written) => {
      const once = await openAndSaveUnedited(file);
      expect(once).toBe(written);
      expect(await openAndSaveUnedited(once)).toBe(once);
      expect(markdownToHtml(once)).toContain('<p>');
      expect(markdownToHtml(once)).not.toMatch(/<h[12]/);
    },
  );

  // GitHub reads `---` directly under a definition as text, so the pair is
  // refused whatever the rule's spelling (AMP review of #592).
  it.each([
    ['`***`', '[a]: https://example.com\n***\n'],
    ['`---`', '[a]: https://example.com\n---\n'],
    ['`___`, in a quote', '> [a]: https://example.com\n> ___\n'],
  ])(
    'a reference definition over a rule spelled %s keeps a blank line, and holds still',
    async (_label, file) => {
      const once = await openAndSaveUnedited(file);
      expect(once).toMatch(/https:\/\/example\.com\n(?:> ?)?\n(?:> )?---\n$/);
      expect(await openAndSaveUnedited(once)).toBe(once);
    },
  );

  it('a rule that comes under a definition through an edit keeps a blank line (D3)', () => {
    const instance = editorWith('[a]: https://example.com\nText.\n***\n');
    let from = -1;
    let to = -1;
    instance.editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'paragraph' && node.textContent === 'Text.') {
        from = offset;
        to = offset + node.nodeSize;
      }
    });
    instance.editor.chain().deleteRange({ from, to }).run();
    expect(instance.getMarkdown()).toBe('[a]: https://example.com\n\n---');
  });

  it('a footnote definition over a rule stays adjacent', async () => {
    const file = 'Text.[^1]\n\n[^1]: note\n---\n';
    expect(await openAndSaveUnedited(file)).toBe(file);
  });

  it('a document that reads otherwise whole is written as before #568, and holds still', async () => {
    // Each pair reads the same alone; the lazy lines around them do not.
    // The bytes are what `e94d5a9` wrote.
    const file = '- a\n    - b\ny\n    <!-- c -->\nz\n';
    const once = await openAndSaveUnedited(file);
    expect(once).toBe('- a\n\n  - b\n    y\n\n    <!-- c -->\n\n  z\n');
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it('a document that carries one of the marks is written as before #568', async () => {
    // The step aside of #425: a character the person typed is never taken.
    const file = '# Head \nText .\n';
    expect(await openAndSaveUnedited(file)).toBe('# Head \n\nText .\n');
  });
});

describe('edits: the flag follows the block, and the save decides (#568, D3)', () => {
  it.each([
    [
      'the heading turned into a paragraph',
      '# Head\nText.\n',
      (e: EditorInstance) =>
        e.editor.chain().setTextSelection(blockStart(e, 0)).setParagraph().run(),
      'Head\n\nText.',
    ],
    [
      'a quote over a heading turned into a paragraph',
      '> quote\n# Head\n',
      (e: EditorInstance) =>
        e.editor.chain().setTextSelection(blockStart(e, 1)).setParagraph().run(),
      '> quote\n\nHead',
    ],
    [
      'a list over a heading turned into a paragraph',
      '- item\n# Head\n',
      (e: EditorInstance) =>
        e.editor.chain().setTextSelection(blockStart(e, 1)).setParagraph().run(),
      '- item\n\nHead',
    ],
    [
      'a paragraph over a list turned into a heading',
      'Text.\n- item\n',
      (e: EditorInstance) =>
        e.editor.chain().setTextSelection(blockStart(e, 0)).setHeading({ level: 2 }).run(),
      '## Text.\n- item',
    ],
    [
      'Enter at the end of the heading, then text',
      '# Head\nText.\n',
      (e: EditorInstance) =>
        e.editor.chain().setTextSelection(blockEnd(e, 0)).splitBlock().insertContent('New').run(),
      '# Head\n\nNew\n\nText.',
    ],
    [
      'Enter at the end of the paragraph, then text',
      '# Head\nText.\n',
      (e: EditorInstance) =>
        e.editor.chain().setTextSelection(blockEnd(e, 1)).splitBlock().insertContent('New').run(),
      '# Head\nText.\n\nNew',
    ],
    [
      'Enter in the middle of the flagged paragraph',
      '# Head\nText here.\n',
      (e: EditorInstance) =>
        e.editor
          .chain()
          .setTextSelection(blockStart(e, 1) + 4)
          .splitBlock()
          .run(),
      '# Head\nText\n\nhere.',
    ],
    [
      'Enter at the start of the flagged paragraph',
      '# Head\nText.\n',
      (e: EditorInstance) => e.editor.chain().setTextSelection(blockStart(e, 1)).splitBlock().run(),
      '# Head\n\nText.',
    ],
    [
      'the heading deleted, the paragraph now under a quote',
      '> quote\n\n# Head\nText.\n',
      (e: EditorInstance) => {
        const from = blockStart(e, 1) - 1;
        return e.editor
          .chain()
          .deleteRange({ from, to: from + e.editor.state.doc.child(1).nodeSize })
          .run();
      },
      '> quote\n\nText.',
    ],
    [
      'the paragraph typed into',
      '# Head\nText.\n',
      (e: EditorInstance) =>
        e.editor.chain().setTextSelection(blockEnd(e, 1)).insertContent(' More').run(),
      '# Head\nText. More',
    ],
    [
      'a rule inserted between the heading and the paragraph',
      '# Head\nText.\n',
      (e: EditorInstance) =>
        e.editor.chain().setTextSelection(blockEnd(e, 0)).setHorizontalRule().run(),
      '# Head\n\n---\nText.',
    ],
  ])('%s', (_label, file, edit, written) => {
    const instance = editorWith(file);
    edit(instance);
    expect(instance.getMarkdown()).toBe(written);
  });
});

describe('Enter gives the second half of a split no flag, wherever the caret stands (#594)', () => {
  /** Where `text` starts in the document, plus `offset`. */
  function at(instance: EditorInstance, text: string, offset: number): number {
    let found = -1;
    instance.editor.state.doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text?.includes(text)) {
        found = pos + node.text.indexOf(text) + offset;
      }
    });
    if (found < 0) throw new Error(`not found: ${text}`);
    return found;
  }

  /** The flag of the block whose text starts with `text`. */
  function flagOf(instance: EditorInstance, text: string): unknown {
    let flag: unknown = null;
    instance.editor.state.doc.descendants((node) => {
      if (flag === null && node.isTextblock && node.textContent.startsWith(text)) {
        flag = node.attrs.adjacent;
      }
    });
    return flag;
  }

  /** Enter through the keymap, as a key press, then a word typed. */
  function enterThenType(instance: EditorInstance, word: string): void {
    const { view } = instance.editor;
    view.someProp('handleKeyDown', (handler) =>
      handler(view, new KeyboardEvent('keydown', { key: 'Enter' })),
    );
    instance.editor.commands.insertContent(word);
  }

  // [label, file, the flagged text, caret offset in it, first half, second half, written]
  const ROWS: ReadonlyArray<readonly [string, string, string, number, string, string, string]> = [
    [
      'a paragraph, in the middle',
      '# Head\nText here.\n',
      'Text here.',
      4,
      'Text',
      'X here.',
      '# Head\nText\n\nX here.',
    ],
    [
      'a paragraph, at the start',
      '# Head\nText here.\n',
      'Text here.',
      0,
      '',
      'XText here.',
      '# Head\n\nXText here.',
    ],
    [
      'a paragraph, at the end',
      '# Head\nText here.\n',
      'Text here.',
      10,
      'Text here.',
      'X',
      '# Head\nText here.\n\nX',
    ],
    [
      'a heading, in the middle',
      '# Head\n## Second heading\n',
      'Second heading',
      6,
      'Second',
      'X heading',
      '# Head\n## Second\n\n## X heading',
    ],
    [
      'a heading, at the start',
      '# Head\n## Second heading\n',
      'Second heading',
      0,
      '',
      'XSecond heading',
      '# Head\n\n## XSecond heading',
    ],
    [
      'a heading, at the end',
      '# Head\n## Second heading\n',
      'Second heading',
      14,
      'Second heading',
      'X',
      '# Head\n## Second heading\n\nX',
    ],
    [
      'a paragraph in a list item, in the middle',
      '- # Head\n  Text here.\n',
      'Text here.',
      4,
      'Text',
      'X here.',
      '- # Head\n  Text\n- X here.',
    ],
    [
      'a paragraph in a list item, at the start',
      '- # Head\n  Text here.\n',
      'Text here.',
      0,
      '',
      'XText here.',
      '- # Head\n- XText here.',
    ],
    [
      'a paragraph in a list item, at the end',
      '- # Head\n  Text here.\n',
      'Text here.',
      10,
      'Text here.',
      'X',
      '- # Head\n  Text here.\n- X',
    ],
    [
      'a heading in a list item, in the middle',
      '- Text.\n  # Head here\n',
      'Head here',
      4,
      'Head',
      'X here',
      '- Text.\n  # Head\n- # X here',
    ],
    [
      'a heading in a list item, at the start',
      '- Text.\n  # Head here\n',
      'Head here',
      0,
      '',
      'XHead here',
      '- Text.\n  #\n- # XHead here',
    ],
    [
      'a heading in a list item, at the end',
      '- Text.\n  # Head here\n',
      'Head here',
      9,
      'Head here',
      'X',
      '- Text.\n  # Head here\n- X',
    ],
  ];

  it.each(ROWS)('%s', (_label, file, flagged, offset, first, second, written) => {
    const instance = editorWith(file);
    expect(flagOf(instance, flagged)).toBe(true);
    instance.editor.commands.setTextSelection(at(instance, flagged, offset));
    enterThenType(instance, 'X');
    expect(flagOf(instance, second), 'the second half').toBe(false);
    if (first !== '') expect(flagOf(instance, first), 'the first half').toBe(true);
    expect(instance.getMarkdown()).toBe(written);
  });

  it('an undo after the split gives the file back', () => {
    const file = '# Head\nText here.\n';
    const instance = editorWith(file);
    instance.editor.commands.setTextSelection(at(instance, 'Text here.', 4));
    const { view } = instance.editor;
    view.someProp('handleKeyDown', (handler) =>
      handler(view, new KeyboardEvent('keydown', { key: 'Enter' })),
    );
    instance.editor.commands.undo();
    expect(flagOf(instance, 'Text here.')).toBe(true);
    expect(instance.getMarkdown()).toBe('# Head\nText here.');
  });
});

describe('a paste carries no flag (#568)', () => {
  it('a plain-text paste of two adjacent blocks is written a blank line apart', () => {
    const instance = editorWith('');
    paste(instance, { 'text/plain': '# A\nB' });
    expect(instance.getMarkdown()).not.toMatch(/# A\nB/);
    expect(instance.getMarkdown()).toContain('# A\n\nB');
  });

  it('HTML copied from the editor loses the flag when pasted', () => {
    const source = editorWith('# Head\nText.\n');
    const copied = source.editor.getHTML();
    expect(copied).toContain(ADJACENT_ATTRIBUTE);
    expect(cleanPastedHtml(copied)).not.toContain(ADJACENT_ATTRIBUTE);
    const target = editorWith('');
    paste(target, { 'text/html': copied, 'text/plain': '# Head\nText.' });
    expect(target.getMarkdown()).toContain('# Head\n\nText.');
  });
});
