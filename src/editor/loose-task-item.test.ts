import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * #686: a loose task item opening with a block holds that block alone.
 *
 * On `89f652e`, in a task list with blank lines between its items, an item
 * opening with a heading, a code block, a quote, a table, a rule or a nested
 * list held an empty paragraph before that block: `marked` wrote the checkbox
 * in a paragraph of its own and the checkbox rewrite of `parse.ts` left it
 * empty. The editor drew it as an empty line beside the checkbox, and the
 * first Backspace at the start of the block removed it and nothing else.
 * `markTaskLists` now drops it. Each file is opened, saved, and saved again.
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

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  instances.push(instance);
  return instance;
}

/**
 * Open `text` as a file, run `edit` on the editor, save, and return the bytes
 * that reached the disk: the whole path, so the line endings and the final
 * newline are the ones a save writes.
 */
async function openAndSave(
  text: string,
  edit: (instance: EditorInstance) => void = () => {},
): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);
  const instance = editorWith(loaded.document.markdownBody);
  edit(instance);
  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;
  const result = await saveMarkdown(buildDocument(state, instance.getMarkdown), io);
  return result.writtenText;
}

function pressKey(instance: EditorInstance, init: KeyboardEventInit): void {
  const { view } = instance.editor;
  const event = new KeyboardEvent('keydown', init);
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event));
  if (!handled && init.key === 'Enter') instance.editor.commands.enter();
}

/** What each task item holds, as its children's types, item by item. */
function itemShapes(instance: EditorInstance): string[] {
  const shapes: string[] = [];
  instance.editor.state.doc.descendants((node) => {
    if (node.type.name !== 'taskItem' && node.type.name !== 'listItem') return true;
    const kids: string[] = [];
    node.forEach((child) => {
      const empty = child.type.name === 'paragraph' && child.content.size === 0;
      kids.push(`${child.type.name}${empty ? '(empty)' : ''}`);
    });
    shapes.push(kids.join(' '));
    return true;
  });
  return shapes;
}

/** Open, read what the second item holds, save, and save again. */
async function heldAndSaved(text: string): Promise<{ second: string; saved: string }> {
  let second = '';
  const saved = await openAndSave(text, (instance) => {
    second = itemShapes(instance)[1] ?? '';
  });
  expect(await openAndSave(saved), 'the second save').toBe(saved);
  return { second, saved };
}

const BLOCKS: Array<[string, string, string]> = [
  ['a heading of level 1', '# H', 'heading'],
  ['a heading of level 2', '## H', 'heading'],
  ['a heading of level 6', '###### H', 'heading'],
  ['a code block', '```\n  x\n  ```', 'codeBlock'],
  ['a quote', '> q', 'blockquote'],
  ['a table', '| a | b |\n  | --- | --- |\n  | 1 | 2 |', 'table'],
  ['a horizontal rule', '---', 'horizontalRule'],
  ['a nested list', '- c', 'bulletList'],
];

describe('a loose task item opening with a block holds the block alone (#686)', () => {
  it.each(BLOCKS)('opening with %s', async (_label, block, type) => {
    const text = `- [ ] a\n\n- [ ] ${block}\n\n- [ ] z\n`;
    const { second, saved } = await heldAndSaved(text);
    expect(second).toBe(type);
    expect(saved).toBe(text);
  });
});

describe('what the change leaves as it was (#686)', () => {
  it.each([
    ['a loose task item opening with a paragraph', '- [ ] a\n\n- [ ] p\n\n- [ ] z\n', 'paragraph'],
    [
      'a loose task item, a paragraph then a heading',
      '- [ ] a\n\n- [ ] p\n\n  ## H\n\n- [ ] z\n',
      'paragraph heading',
    ],
    [
      'an empty loose task item, whose paragraph is the whole of it',
      '- [ ] a\n\n- [ ] \n\n- [ ] z\n',
      'paragraph(empty)',
    ],
  ])('%s', async (_label, text, shape) => {
    const { second, saved } = await heldAndSaved(text);
    expect(second).toBe(shape);
    expect(saved).toBe(text);
  });

  it.each(BLOCKS)('a tight task item opening with %s', async (_label, block, type) => {
    const text = `- [ ] a\n- [ ] ${block}\n- [ ] z\n`;
    const { second, saved } = await heldAndSaved(text);
    expect(second).toBe(type);
    expect(saved).toBe(text);
  });

  // `- ---` is itself a thematic break, so the bullet rows spell the rule `***`.
  const BULLET_BLOCKS = BLOCKS.map(([label, block, type]): [string, string, string] =>
    block === '---' ? [label, '***', type] : [label, block, type],
  );
  it.each(BULLET_BLOCKS)('a loose bullet item opening with %s', async (_label, block, type) => {
    const text = `- a\n\n- ${block}\n\n- z\n`;
    const { second, saved } = await heldAndSaved(text);
    expect(second).toBe(type);
    expect(saved).toBe(text);
  });
  it.each(BULLET_BLOCKS)('a tight bullet item opening with %s', async (_label, block, type) => {
    const text = `- a\n- ${block}\n- z\n`;
    const { second, saved } = await heldAndSaved(text);
    expect(second).toBe(type);
    expect(saved).toBe(text);
  });
});

describe('a loose task list pasted as markdown text (#686)', () => {
  it('holds the heading alone in its item', async () => {
    let shapes: string[] = [];
    const saved = await openAndSave('start\n', (instance) => {
      instance.editor.commands.setTextSelection(1);
      const { view } = instance.editor;
      const data: Record<string, string> = { 'text/plain': '- [ ] a\n\n- [ ] ## H\n\n- [ ] z' };
      const event = {
        clipboardData: {
          types: Object.keys(data),
          getData: (t: string) => data[t] ?? '',
          files: [],
        },
        preventDefault: () => undefined,
      } as unknown as ClipboardEvent;
      view.someProp('handlePaste', (handler) =>
        handler(view, event, view.state.selection.content()),
      );
      shapes = itemShapes(instance);
    });
    expect(shapes).toEqual(['paragraph', 'heading', 'paragraph']);
    expect(saved).toBe('- [ ] a\n\n- [ ] ## H\n\n- [ ] zstart\n');
  });
});

describe('Backspace at the start of the block joins the item above, at the first press (#686)', () => {
  /** The position at the start of the first node of `type`. */
  function startOf(instance: EditorInstance, type: string): number {
    let found = -1;
    instance.editor.state.doc.descendants((node, pos) => {
      if (found === -1 && node.type.name === type) found = pos + 1;
    });
    if (found === -1) throw new Error(`no ${type} in the document`);
    return found;
  }

  it.each([
    [
      'a loose item opening with a heading',
      '- [ ] a\n\n- [ ] ## H\n\n- [ ] z\n',
      'heading',
      '- [ ] a\n  ## H\n\n- [ ] z\n',
    ],
    [
      'a loose item opening with a code block',
      '- [ ] a\n\n- [ ] ```\n  x\n  ```\n\n- [ ] z\n',
      'codeBlock',
      '- [ ] a\n  ```\n  x\n  ```\n\n- [ ] z\n',
    ],
    [
      'a tight item opening with a heading, as before',
      '- [ ] a\n- [ ] ## H\n- [ ] z\n',
      'heading',
      '- [ ] a\n  ## H\n- [ ] z\n',
    ],
  ])('%s', async (_label, text, type, expected) => {
    const saved = await openAndSave(text, (instance) => {
      instance.editor.commands.setTextSelection(startOf(instance, type));
      pressKey(instance, { key: 'Backspace' });
    });
    expect(saved).toBe(expected);
    expect(await openAndSave(saved), 'the second save').toBe(saved);
  });
});
