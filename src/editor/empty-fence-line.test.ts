import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { insertCodeBlock } from './insert-code-block';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * #625: an empty fence holding one blank line keeps the line.
 *
 * On `281d1e1` `marked` handed ```` ```⏎⏎``` ```` and ```` ```⏎``` ```` over
 * as one empty code token, the editor held both as `\n`, and both were
 * written as the empty fence of none, which GitHub reads otherwise. The parse
 * now stamps the first from the raw of its token, and the blank rule of
 * `markdown/empty-fence.ts` writes the line back. Each shape is opened as a
 * file, saved, and saved again; the reading of each by cmark-gfm is on the
 * pull request.
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

async function holds(text: string, expected: string = text): Promise<void> {
  const once = await openAndSave(text);
  expect(once, 'the first save').toBe(expected);
  expect(await openAndSave(once), 'the second save').toBe(once);
}

/** The position just inside the first code block, before what it holds. */
function insideFirstBlock(instance: EditorInstance): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'codeBlock') found = pos + 1;
  });
  if (found === -1) throw new Error('no code block in the document');
  return found;
}

function pressKey(instance: EditorInstance, init: KeyboardEventInit): void {
  const { view } = instance.editor;
  const event = new KeyboardEvent('keydown', init);
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event));
  if (!handled && init.key === 'Enter') instance.editor.commands.enter();
}

/** Delete the character before the caret, or after it, as Backspace and Delete do. */
function deleteBeside(instance: EditorInstance, side: 'before' | 'after'): void {
  const { view } = instance.editor;
  const { from } = view.state.selection;
  view.dispatch(
    side === 'before' ? view.state.tr.delete(from - 1, from) : view.state.tr.delete(from, from + 1),
  );
}

/** Feed text the way a keypress does, so the markdown input rules run. */
function typeText(instance: EditorInstance, text: string): void {
  const { view } = instance.editor;
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

describe('an empty fence holding one blank line keeps it (#625)', () => {
  it.each([
    ['at the top level', '```\n\n```\n'],
    ['with a language', '```js\n\n```\n'],
    ['between two paragraphs', 'a\n\n```\n\n```\n\nb\n'],
    ['in a quote, a marker and a space on the line', '> ```\n> \n> ```\n'],
    ['in a list item', '- a\n\n  ```\n\n  ```\n'],
    ['with no final newline', '```\n\n```'],
    ['with CRLF line endings', '```\r\n\r\n```\r\n'],
    ['two in a row', '```\n\n```\n\n```js\n\n```\n'],
  ])('%s', async (_shape, text) => {
    await holds(text);
  });

  it.each([
    ['a tilde fence', '~~~\n\n~~~\n'],
    ['a run of four backticks', '````\n\n````\n'],
    ['unclosed at the end of the file', '```\n\n'],
  ])(
    '%s keeps the line, written with three backticks as GitHub reads it alike',
    async (_shape, text) => {
      await holds(text, '```\n\n```\n');
    },
  );
});

describe('a quote that holds only the fence', () => {
  it('spelling its line as a bare marker writes it with a space, as GitHub reads it alike', async () => {
    // A quote blank but for its fence is written by turndown's own quote rule,
    // through the container half of the blank hook (#104), and not by the rule
    // that keeps a bare marker (#199). R-C2 records the respelling.
    await holds('> ```\n>\n> ```\n', '> ```\n> \n> ```\n');
  });

  it('holding a paragraph too keeps the bare marker', async () => {
    await holds('> a\n>\n> ```\n>\n> ```\n');
  });
});

describe('the controls are written as on main', () => {
  it.each([
    ['two blank lines (#572)', '```\n\n\n```\n'],
    ['a line of spaces', '```\n   \n```\n'],
    ['nothing between the fences', '```\n```\n'],
    ['nothing between, with a language', '```js\n```\n'],
    ['nothing between, unclosed at the end', '```\n'],
  ])('%s', async (_shape, text) => {
    await holds(text, text === '```\n' ? '```\n```\n' : text);
  });
});

describe('an edit of the block (#625)', () => {
  const TEXT = 'a\n\n```js\n\n```\n\nb\n';

  it('a character typed and deleted writes the file as it was', async () => {
    const saved = await openAndSave(TEXT, (instance) => {
      instance.editor.commands.setTextSelection(insideFirstBlock(instance));
      typeText(instance, 'x');
      deleteBeside(instance, 'before');
    });
    expect(saved).toBe(TEXT);
  });

  it('a character typed and kept is the content of the block', async () => {
    const saved = await openAndSave(TEXT, (instance) => {
      instance.editor.commands.setTextSelection(insideFirstBlock(instance));
      typeText(instance, 'x');
    });
    expect(saved).toBe('a\n\n```js\nx\n```\n\nb\n');
  });

  it('Enter adds a line, which is then content', async () => {
    const saved = await openAndSave(TEXT, (instance) => {
      instance.editor.commands.setTextSelection(insideFirstBlock(instance));
      pressKey(instance, { key: 'Enter' });
    });
    expect(saved).toBe('a\n\n```js\n\n\n```\n\nb\n');
  });

  it('undo after Enter gives the line back', async () => {
    const saved = await openAndSave(TEXT, (instance) => {
      instance.editor.commands.setTextSelection(insideFirstBlock(instance));
      pressKey(instance, { key: 'Enter' });
      instance.editor.commands.undo();
    });
    expect(saved).toBe(TEXT);
  });

  it('the line ending deleted leaves the fence of none the block then holds', async () => {
    const saved = await openAndSave(TEXT, (instance) => {
      instance.editor.commands.setTextSelection(insideFirstBlock(instance));
      deleteBeside(instance, 'after');
    });
    expect(saved).toBe('a\n\n```js\n```\n\nb\n');
  });

  /** The blank-line flag of each code block, in order. */
  function flags(instance: EditorInstance): string {
    const found: string[] = [];
    instance.editor.state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') found.push(`${node.attrs.fenceBlankLine}`);
    });
    return found.join(' ');
  }

  it('a split at its start makes it the second half, which carries nothing (#594)', async () => {
    // `splitBlock` copies every attribute through `tr.split`; the plugin of
    // #594 clears the flag off the second half as it clears the opener (#573).
    let held = '';
    const saved = await openAndSave(TEXT, (instance) => {
      instance.editor.chain().setTextSelection(insideFirstBlock(instance)).splitBlock().run();
      held = flags(instance);
    });
    expect(held).toBe('false');
    expect(saved).toBe('a\n\n```js\n```\n\nb\n');
  });

  it('a split at its end leaves it whole, and it keeps the line', async () => {
    let held = '';
    const saved = await openAndSave(TEXT, (instance) => {
      instance.editor
        .chain()
        .setTextSelection(insideFirstBlock(instance) + 1)
        .splitBlock()
        .run();
      held = flags(instance);
    });
    expect(held).toBe('true');
    expect(saved).toBe(TEXT);
  });
});

describe('a block the editor makes is written with nothing between its fences (R-C15)', () => {
  function made(make: (instance: EditorInstance) => void): string {
    const instance = editorWith('');
    make(instance);
    return instance.getMarkdown().trim();
  }

  it('the backtick input rule', () => {
    expect(made((instance) => typeText(instance, '``` '))).toBe('```\n```');
  });

  it('the tilde input rule', () => {
    expect(made((instance) => typeText(instance, '~~~ '))).toBe('```\n```');
  });

  it('Insert Code Block', () => {
    expect(made((instance) => insertCodeBlock(instance.editor))).toBe('```\n```');
  });

  it('Ctrl+Alt+C', () => {
    expect(
      made((instance) =>
        pressKey(instance, { key: 'c', code: 'KeyC', ctrlKey: true, altKey: true }),
      ),
    ).toBe('```\n```');
  });

  it('a page that spells the attribute pastes a fence of none (#447)', () => {
    const instance = editorWith('start');
    instance.editor.commands.setTextSelection(1);
    const html = '<pre data-fence-blank-line><code>\n</code></pre><p>after</p>';
    const data: Record<string, string> = { 'text/html': html, 'text/plain': 'after' };
    const event = {
      clipboardData: { types: Object.keys(data), getData: (t: string) => data[t] ?? '', files: [] },
      preventDefault: () => undefined,
    } as unknown as ClipboardEvent;
    const { view } = instance.editor;
    view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
    expect(instance.getMarkdown()).toBe('```\n```\n\nafterstart');
  });
});
