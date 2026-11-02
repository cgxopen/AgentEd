import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * #679: Enter in a code block inside a list item adds a line.
 *
 * On `56bc7f0` the Enter of the list item and of the task item ran before the
 * code block and the core keymap, and split the item, and the code block with
 * it, at any caret position and over a range in the code. Each file is opened,
 * the key is sent through the keymaps of the editor, the document is saved,
 * and the saved file is opened and saved again.
 */

let instances: EditorInstance[] = [];

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.innerHTML = '';
});

const DOCUMENT_PATH = '/doc/notes.md';

/** A disk that records exactly what was written to it (the shape #79 uses). */
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

/** Open `text` as a file, run `edit`, save, and return the bytes written. */
async function openAndSave(
  text: string,
  edit: (instance: EditorInstance) => void = () => {},
): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(loaded.document.markdownBody);
  instances.push(instance);
  edit(instance);
  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;
  return (await saveMarkdown(buildDocument(state, instance.getMarkdown), io)).writtenText;
}

/** Open, edit, save, and check that the saved file holds on a second save. */
async function savedTwice(text: string, edit: (instance: EditorInstance) => void): Promise<string> {
  const once = await openAndSave(text, edit);
  expect(await openAndSave(once), 'the second save').toBe(once);
  return once;
}

/** Send Enter through the keymaps of the editor, as a keypress does. */
function pressEnter(instance: EditorInstance): void {
  const { view } = instance.editor;
  const event = new KeyboardEvent('keydown', { key: 'Enter' });
  view.someProp('handleKeyDown', (handler) => handler(view, event));
}

/** The text range of the first block of `type` holding `text`, or of the first code block. */
function rangeOf(
  instance: EditorInstance,
  type: string,
  text?: string,
): { from: number; to: number } {
  let range: { from: number; to: number } | null = null;
  instance.editor.state.doc.descendants((node, pos) => {
    if (range || node.type.name !== type) return true;
    if (text !== undefined && node.textContent !== text) return true;
    range = { from: pos + 1, to: pos + node.nodeSize - 1 };
    return false;
  });
  if (!range) throw new Error(`no ${type} in the document`);
  return range;
}

function select(instance: EditorInstance, from: number, to: number = from): void {
  const { state, view } = instance.editor;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

/** The nodes from the document down to the caret, and its offset there. */
function caretPath(instance: EditorInstance): string {
  const { $head } = instance.editor.state.selection;
  const path: string[] = [];
  for (let depth = 1; depth <= $head.depth; depth += 1) path.push($head.node(depth).type.name);
  return path.join('>');
}

// Each list kind, with the code `xy`; `p` is the indentation of the code.
const KINDS: Array<[string, string, string, string]> = [
  ['a bullet item', '- a\n\n', '  ', ''],
  ['an ordered item', '1. a\n\n', '   ', ''],
  ['a task item', '- [ ] a\n\n', '  ', ''],
  ['an item of a list nested in a bullet item', '- a\n  - b\n\n', '    ', ''],
  ['an item of a list nested in an ordered item', '1. a\n   - b\n\n', '     ', ''],
  ['a bullet item whose first block is the code', '- ', '  ', 'first'],
];

/** The file with the code of a kind holding `code`, one line per entry. */
function fileOf(lead: string, indent: string, first: string, code: string[]): string {
  const opener = first === 'first' ? '```\n' : `${indent}\`\`\`\n`;
  return `${lead}${opener}${code.map((line) => (line === '' ? '\n' : `${indent}${line}\n`)).join('')}${indent}\`\`\`\n`;
}

describe('Enter in a code block in a list item adds a line (#679)', () => {
  const POSITIONS: Array<
    [string, (code: { from: number; to: number }) => [number, number], string[]]
  > = [
    ['at the start', (code) => [code.from, code.from], ['', 'xy']],
    ['in the middle', (code) => [code.from + 1, code.from + 1], ['x', 'y']],
    ['at the end', (code) => [code.to, code.to], ['xy', '']],
    ['over a range', (code) => [code.from, code.from + 1], ['', 'y']],
  ];

  for (const [kind, lead, indent, first] of KINDS) {
    it.each(POSITIONS)(`in ${kind}, %s`, async (_position, where, lines) => {
      const saved = await savedTwice(fileOf(lead, indent, first, ['xy']), (instance) => {
        select(instance, ...where(rangeOf(instance, 'codeBlock')));
        pressEnter(instance);
      });
      expect(saved).toBe(fileOf(lead, indent, first, lines));
    });
  }

  it('in a quote inside a list item, as it did before', async () => {
    const saved = await savedTwice('- a\n\n  > ```\n  > xy\n  > ```\n', (instance) => {
      select(instance, rangeOf(instance, 'codeBlock').from + 1);
      pressEnter(instance);
    });
    expect(saved).toBe('- a\n\n  > ```\n  > x\n  > y\n  > ```\n');
  });

  it('in an empty code block, two Enters add two lines and leave the item whole', async () => {
    const saved = await savedTwice('- a\n\n  ```\n  ```\n', (instance) => {
      select(instance, rangeOf(instance, 'codeBlock').from);
      pressEnter(instance);
      pressEnter(instance);
    });
    expect(saved).toBe('- a\n\n  ```\n\n\n  ```\n');
  });
});

describe('leaving the code block on Enter lands where it lands outside a list (#679)', () => {
  // An opened block holds the line ending `marked` puts at its end, so with
  // the caret at the end the second Enter is the one the code block reads as
  // the request to leave, at the top level as in a list (#675).
  it.each([
    ['at the top level', '```\nxy\n```\n', 'paragraph'],
    ['in a quote', '> ```\n> xy\n> ```\n', 'blockquote>paragraph'],
    ['in a bullet item', '- a\n\n  ```\n  xy\n  ```\n', 'bulletList>listItem>paragraph'],
    ['in an ordered item', '1. a\n\n   ```\n   xy\n   ```\n', 'orderedList>listItem>paragraph'],
    ['in a task item', '- [ ] a\n\n  ```\n  xy\n  ```\n', 'taskList>taskItem>paragraph'],
  ])('%s, in a paragraph after the block, in the same container', async (_where, text, path) => {
    let landed = '';
    const saved = await savedTwice(text, (instance) => {
      select(instance, rangeOf(instance, 'codeBlock').to);
      pressEnter(instance);
      pressEnter(instance);
      landed = caretPath(instance);
    });
    expect(landed).toBe(path);
    expect(saved).toBe(text);
  });
});

describe('what the change does not touch (#679)', () => {
  it.each([
    ['a bullet item', '- ab\n- c\n', '- a\n- b\n- c\n'],
    ['an ordered item', '1. ab\n2. c\n', '1. a\n2. b\n3. c\n'],
    ['a task item', '- [ ] ab\n- [ ] c\n', '- [ ] a\n- [ ] b\n- [ ] c\n'],
    ['a nested item', '- a\n  - ab\n', '- a\n  - a\n  - b\n'],
  ])('Enter in the paragraph of %s splits it', async (_kind, text, expected) => {
    const saved = await savedTwice(text, (instance) => {
      select(instance, rangeOf(instance, 'paragraph', 'ab').from + 1);
      pressEnter(instance);
    });
    expect(saved).toBe(expected);
  });

  it('Enter in the paragraph above a code block in an item splits the item there', async () => {
    const saved = await savedTwice('- a\n\n  ```\n  xy\n  ```\n', (instance) => {
      select(instance, rangeOf(instance, 'paragraph', 'a').to);
      pressEnter(instance);
    });
    expect(saved).toBe('- a\n- ```\n  xy\n  ```\n');
  });

  it.each([
    ['a bullet list', '- a\n- b\n'],
    ['an ordered list', '1. a\n2. b\n'],
    ['a task list', '- [ ] a\n- [ ] b\n'],
  ])('Enter in an empty last item leaves %s', async (_kind, text) => {
    let landed = '';
    const saved = await savedTwice(text, (instance) => {
      select(instance, rangeOf(instance, 'paragraph', 'b').to);
      pressEnter(instance);
      pressEnter(instance);
      landed = caretPath(instance);
    });
    expect(landed).toBe('paragraph');
    expect(saved).toBe(text);
  });

  it.each([
    ['at the top level', '```\nxy\n```\n', '```\nx\ny\n```\n'],
    ['in a quote', '> ```\n> xy\n> ```\n', '> ```\n> x\n> y\n> ```\n'],
  ])('Enter in a code block %s adds a line, as before', async (_where, text, expected) => {
    const saved = await savedTwice(text, (instance) => {
      select(instance, rangeOf(instance, 'codeBlock').from + 1);
      pressEnter(instance);
    });
    expect(saved).toBe(expected);
  });
});
