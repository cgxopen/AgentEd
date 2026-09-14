/**
 * Insert Metadata (#297), driven the way a person meets it: the entry the
 * shipped `index.html` renders, clicked through the real `setupMenu`, over the
 * real metadata panel from the same page, and then the bytes the real save flow
 * writes to an in-memory disk.
 *
 * Nothing here is owed to a manual pass for what it asserts: a click, a change
 * to the document, focus, a class on the panel and bytes on disk are all
 * visible to the harness. The manual pass is where the same states are seen on
 * WebView2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import { splitFrontmatter } from '../formats/frontmatter';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { getTemplate, type Template } from '../templates';
import {
  type FrontmatterPanel,
  setupFrontmatterPanel,
  shouldShowFrontmatterPanel,
} from '../ui/frontmatter-panel';
import { type MenuCallbacks, setupMenu } from '../ui/menu';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { metadataBlockFor, metadataMenuCallbacks, yamlTitle } from './insert-metadata';
import { AppState } from './state';

// ─────────────────────────────────────────────────────────────────────────────
// The harness: an in-memory disk, and the template module watched rather than
// replaced, so one test can hand the route a different template.
// ─────────────────────────────────────────────────────────────────────────────

let disk: Map<string, string>;
let savePathAnswer: string | null;

const io: PlatformIO = {
  supportsMultiFile: true,
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
  pickSavePath: async () => savePathAnswer,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));
vi.mock('../templates', async (importOriginal) => {
  const original = await importOriginal<typeof import('../templates')>();
  return { ...original, getTemplate: vi.fn(original.getTemplate) };
});

const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async (message: string, _e: unknown, title?: string) => {
    throw new Error(`unexpected failure dialog: ${title}: ${message}`);
  },
};

/** The block of the Blank + metadata template, read the way the template gallery reads it. */
function templateBlock(): string {
  const template = getTemplate('blank-frontmatter');
  const block = template ? splitFrontmatter(template.body).raw : null;
  if (block === null) throw new Error('the Blank + metadata template has no metadata block');
  return block;
}

const PATH = '/doc/notes.md';

let editor: EditorInstance | null = null;

beforeEach(() => {
  disk = new Map();
  savePathAnswer = null;
  clearImages();
  document.body.innerHTML = '';
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  // Reset rather than clear: a value queued with mockReturnValueOnce and never
  // used would otherwise reach the next test (measured on reversal R5).
  vi.mocked(getTemplate).mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// The block
// ─────────────────────────────────────────────────────────────────────────────

describe('the block Insert Metadata writes', () => {
  it('is the Blank + metadata template block for a document with no file yet', () => {
    expect(metadataBlockFor(null)).toBe(templateBlock());
    // The five fields the owner chose on #297, by name.
    expect(
      templateBlock()
        .split('\n')
        .map((line) => line.slice(0, line.indexOf(':'))),
    ).toEqual(['title', 'description', 'author', 'date', 'tags']);
  });

  it('differs from the template only in the title line for a document that has a file', () => {
    const template = templateBlock().split('\n');
    const block = metadataBlockFor(PATH).split('\n');

    expect(block[0]).toBe('title: notes');
    expect(block.slice(1)).toEqual(template.slice(1));
  });

  it('follows the template rather than restating it', () => {
    // The rule that the two routes cannot drift apart, as a property: hand the
    // route a different template and the block follows it.
    const other: Template = {
      id: 'blank-frontmatter',
      displayName: 'Blank + metadata',
      icon: '',
      description: '',
      body: '---\ntitle: Untitled\nsummary:\n---\n\n# Untitled\n',
    };
    // Once per call below, so no other test sees this template.
    vi.mocked(getTemplate).mockReturnValueOnce(other).mockReturnValueOnce(other);

    expect(metadataBlockFor(null)).toBe('title: Untitled\nsummary:');
    expect(metadataBlockFor(PATH)).toBe('title: notes\nsummary:');
  });

  it.each([
    ['a plain name', '/doc/notes.md', 'title: notes'],
    [
      'a Windows path with a space',
      'C:\\Users\\vasil\\Documents\\Meeting notes.md',
      'title: Meeting notes',
    ],
    ['a name with a dot before the extension', '/doc/notes.v2.md', 'title: notes.v2'],
    ['a name with letters outside ASCII', '/doc/însemnări.md', 'title: însemnări'],
    ['a name YAML reads as a boolean', '/doc/true.md', "title: 'true'"],
    ['a name YAML 1.1 reads as a boolean', '/doc/No.md', "title: 'No'"],
    ['a name YAML reads as a date', '/doc/2026-09-14.md', "title: '2026-09-14'"],
    ['a name YAML reads as a number', '/doc/42.md', "title: '42'"],
    ['a name holding a single quote', "/doc/it's.md", "title: 'it''s'"],
    ['a name holding a colon and a space', '/doc/a: b.md', "title: 'a: b'"],
    ['a name holding a space and a hash', '/doc/draft #2.md', "title: 'draft #2'"],
    ['a name starting with an indicator', '/doc/[wip] plan.md', "title: '[wip] plan'"],
    ['a name holding a replacement pattern', '/doc/cost $&.md', "title: 'cost $&'"],
    ['a name that is only an extension', '/doc/.md', 'title: Untitled'],
  ])('writes the title of %s', (_what, path, line) => {
    expect(metadataBlockFor(path).split('\n')[0]).toBe(line);
  });

  it('writes a name plainly when YAML reads it back unchanged, and quotes a trailing space', () => {
    expect(yamlTitle('Project plan (v2)')).toBe('Project plan (v2)');
    expect(yamlTitle('trailing ')).toBe("'trailing '");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The entry, clicked
// ─────────────────────────────────────────────────────────────────────────────

/** Undo and Redo are not what this file tests, so the menu greys them. */
const nothingToUndo = () => ({ canUndo: false, canRedo: false });

function spies(): MenuCallbacks {
  return {
    onNew: vi.fn(),
    onNewFromTemplate: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onClose: vi.fn(),
    onFind: vi.fn(),
    onReplace: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onInsertTable: vi.fn(),
    onInsertMedia: vi.fn(),
    onInsertCodeBlock: vi.fn(),
    onInsertChecklist: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
    onInsertMetadata: vi.fn(),
    onInsertEmoji: vi.fn(),
    onToggleSidebar: vi.fn(),
    onAbout: vi.fn(),
  };
}

/** The part of the shipped page between two markers, both included. */
function fragment(open: string, close: string): string {
  const start = shippedPage.indexOf(open);
  const end = shippedPage.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`index.html no longer has ${open}`);
  return shippedPage.slice(start, end + close.length);
}

interface Mounted {
  readonly state: AppState;
  readonly details: HTMLDetailsElement;
  readonly textarea: HTMLTextAreaElement;
}

/** The header and the metadata panel from the shipped page, wired the way `main.ts` wires them. */
function mount(filePath: string | null, frontmatter: string | null): Mounted {
  document.body.innerHTML =
    fragment('<header id="menubar">', '</header>') +
    fragment('<details id="frontmatter-panel"', '</details>');
  const state = new AppState();
  state.filePath = filePath;
  state.frontmatter = frontmatter;
  const panel = setupFrontmatterPanel(state);
  panel.refresh();
  panel.setVisible(shouldShowFrontmatterPanel(state));
  setupMenu({ ...spies(), ...metadataMenuCallbacks(state, panel) }, nothingToUndo);
  return {
    state,
    details: document.getElementById('frontmatter-panel') as HTMLDetailsElement,
    textarea: document.getElementById('frontmatter-input') as HTMLTextAreaElement,
  };
}

function chooseInsertMetadata(): void {
  (document.getElementById('menu-toggle') as HTMLElement).click();
  (document.getElementById('menu-section-insert') as HTMLElement).click();
  (document.getElementById('menu-insert-metadata') as HTMLElement).click();
}

describe('choosing Insert Metadata from the menu', () => {
  it('gives a document with a file and no block the block, and opens the panel on it', () => {
    const m = mount(PATH, null);
    expect(m.details.classList.contains('hidden')).toBe(true);

    chooseInsertMetadata();

    expect(m.state.frontmatter).toBe(metadataBlockFor(PATH));
    expect(m.state.modified).toBe(true);
    expect(m.textarea.value).toBe(metadataBlockFor(PATH));
    expect(m.details.classList.contains('hidden')).toBe(false);
    expect(m.details.open).toBe(true);
    expect(document.activeElement).toBe(m.textarea);
  });

  it('gives a document with no file yet the template block, titled Untitled', () => {
    const m = mount(null, null);

    chooseInsertMetadata();

    expect(m.state.frontmatter).toBe(templateBlock());
  });

  it('changes nothing in a document that already has a block, and opens the panel on it', () => {
    // Owner decision (c) on #297: the entry stays active and opens the panel.
    const existing = 'title: Kept\nauthor: someone';
    const m = mount(PATH, existing);

    chooseInsertMetadata();

    expect(m.state.frontmatter).toBe(existing);
    expect(m.state.modified).toBe(false);
    expect(m.textarea.value).toBe(existing);
    expect(m.details.open).toBe(true);
    expect(document.activeElement).toBe(m.textarea);
  });

  it('changes nothing the second time it is chosen', () => {
    const m = mount(PATH, null);
    chooseInsertMetadata();
    m.textarea.value = 'title: Edited';
    m.textarea.dispatchEvent(new Event('input', { bubbles: true }));

    chooseInsertMetadata();

    expect(m.state.frontmatter).toBe('title: Edited');
  });

  it('gives the block back after every field was deleted from the panel', () => {
    const m = mount(PATH, 'title: x');
    m.textarea.value = '';
    m.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(m.state.frontmatter).toBeNull();

    chooseInsertMetadata();

    expect(m.state.frontmatter).toBe(metadataBlockFor(PATH));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bytes on disk
// ─────────────────────────────────────────────────────────────────────────────

/** A panel that records being revealed; the save flow needs refresh and setVisible too. */
function panelStub(): FrontmatterPanel {
  return { refresh: vi.fn(), setVisible: vi.fn(), reveal: vi.fn() };
}

function makeActions(state: AppState, panel: FrontmatterPanel): DocumentActions {
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor = createEditor(host);
  const ctx = {
    state,
    reporter,
    editor: editor.editor,
    getMarkdown: editor.getMarkdown,
    setMarkdown: editor.setMarkdown,
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: panel,
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

/** Open the file, choose the route, save; then open what was written and save it again unedited. */
async function routeThenSaveTwice(text: string): Promise<{ first: string; second: string }> {
  disk.set(PATH, text);
  const state = new AppState();
  const panel = panelStub();
  const actions = makeActions(state, panel);
  await actions.openFilePath(PATH);
  metadataMenuCallbacks(state, panel).onInsertMetadata();
  await actions.handleSave();
  const first = disk.get(PATH) ?? '';

  editor?.destroy();
  const again = new AppState();
  const reopened = makeActions(again, panelStub());
  await reopened.openFilePath(PATH);
  await reopened.handleSave();
  return { first, second: disk.get(PATH) ?? '' };
}

const BOM = '\uFEFF';
const lf = (block: string) => `---\n${block}\n---\n`;
const crlf = (block: string) => lf(block).replace(/\n/g, '\r\n');

describe('a document that had no block, saved after the route, holds still on the next save', () => {
  const block = metadataBlockFor(PATH);

  it.each([
    ['LF', '# Title\n\nPara\n', `${lf(block)}# Title\n\nPara\n`],
    ['CRLF', '# Title\r\n\r\nPara\r\n', `${crlf(block)}# Title\r\n\r\nPara\r\n`],
    ['a byte order mark', `${BOM}# Title\n\nPara\n`, `${BOM}${lf(block)}# Title\n\nPara\n`],
    ['no final newline', '# Title\n\nPara', `${lf(block)}# Title\n\nPara`],
    [
      'a body starting with a paragraph',
      'Para one\n\nPara two\n',
      `${lf(block)}Para one\n\nPara two\n`,
    ],
    ['a body starting with a rule', '---\n\nPara\n', `${lf(block)}---\n\nPara\n`],
    ['an empty document', '', `---\n${block}\n---`],
  ])('%s', async (_shape, text, expected) => {
    const { first, second } = await routeThenSaveTwice(text);

    expect(first).toBe(expected);
    expect(second).toBe(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the route must not change
// ─────────────────────────────────────────────────────────────────────────────

describe('what the route leaves as it was', () => {
  it('still makes a horizontal rule from three dashes typed at the top of an empty document', () => {
    // Measured on the #297 step zero and asserted here, because a document
    // whose first line became metadata instead of a rule would be a new defect
    // wearing this feature.
    const host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor(host);
    editor.setMarkdown('');
    const view = editor.editor.view;
    editor.editor.commands.focus();
    for (const character of '---title: x') {
      const { from, to } = editor.editor.state.selection;
      const handled = view.someProp('handleTextInput', (handler) =>
        handler(view, from, to, character, () => view.state.tr),
      );
      if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
    }

    const nodes: string[] = [];
    editor.editor.state.doc.forEach((node) => {
      nodes.push(`${node.type.name}:${node.textContent}`);
    });
    expect(nodes).toEqual(['horizontalRule:', 'paragraph:title: x']);
    expect(editor.getMarkdown()).toBe('---\n\ntitle: x');
  });

  it('leaves New from Template writing the block the route writes for a document with no file', async () => {
    const state = new AppState();
    const actions = makeActions(state, panelStub());
    savePathAnswer = '/doc/new.md';

    await actions.handleNewFromTemplate('blank-frontmatter');
    expect(state.frontmatter).toBe(metadataBlockFor(null));
    await actions.handleSaveAs();

    expect(disk.get('/doc/new.md')?.startsWith(lf(metadataBlockFor(null)))).toBe(true);
  });
});
