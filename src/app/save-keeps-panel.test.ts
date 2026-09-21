/**
 * #387 — a save never opens again a files panel the person closed by hand.
 *
 * Found at the #380 step zero and driven there: the panel closed, then the
 * call `handleSave` makes, then the panel visible. R-C6 names the acts that
 * ask for the panel, and a save of the document on screen is not one; nor,
 * by owner decision, is a Save As or a reload after an external change.
 *
 * The panel open or closed is an attribute, so both halves are observable.
 * The document actions are the real ones over a real editor, and the panel is
 * the one `setupSidebar` draws from the shipped markup, redrawn by the real
 * `refreshSidebar` over a folder held in a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { EntryPresence, PlatformIO } from '../platform/types';
import { shippedElement } from '../test-support/shipped-markup';
import { documentReferencesImage } from '../ui/document-badges';
import { type Sidebar, setupSidebar } from '../ui/sidebar';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import { refreshSidebar, type SidebarRedraw } from './sidebar-sync';
import { AppState } from './state';

vi.mock('../platform/detect', () => ({ isTauri: true }));

const DOC = '/doc/note.md';
const OTHER = '/other/note.md';

let disk: Map<string, string>;
/** The folders beside a document that the panel lists, and what each holds. */
let folders: Map<string, string[]>;
let saveAsAnswer: string | null;

const io = {
  supportsMultiFile: true,
  canWriteCompanions: async () => true,
  readText: async (path: string) => disk.get(path) ?? '',
  saveFile: async (path: string, content: string) => {
    disk.set(path, content);
  },
  readSnapshot: async (path: string) =>
    disk.has(path) ? { kind: 'file', text: disk.get(path) } : { kind: 'absent' },
  pickSavePath: async () => saveAsAnswer,
  entryPresence: async (path: string): Promise<EntryPresence> =>
    folders.has(path) || disk.has(path) ? 'present' : 'absent',
  listDir: async (dir: string) =>
    (folders.get(dir) ?? []).map((name) => ({ name, path: `${dir}/${name}`, isDirectory: false })),
  mkdir: async () => {},
  writeBinary: async () => {},
  readBinary: async () => new Uint8Array(),
} as unknown as PlatformIO;

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

let instance: EditorInstance;
let host: HTMLElement;
let sidebar: Sidebar;
let actions: DocumentActions;

beforeEach(async () => {
  // Both documents use their `assets/` folder, which is the #402
  // precondition for the panel to be there at all — these rows are about
  // whether it survives a save, not about what raises it.
  disk = new Map([
    [DOC, '# Note\n\n![a](assets/a.png)\n'],
    [OTHER, '# Other\n\n![z](assets/z.png)\n'],
  ]);
  folders = new Map([
    ['/doc/assets', ['a.png']],
    ['/other/assets', ['z.png']],
  ]);
  saveAsAnswer = null;
  document.body.innerHTML = shippedElement(shippedPage, '<aside id="sidebar"');
  sidebar = setupSidebar();
  host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  const state = new AppState();
  actions = createDocumentActions({
    state,
    reporter: { silent: () => {}, toast: () => {}, dialog: async () => {} },
    editor: instance.editor,
    getMarkdown: instance.getMarkdown,
    setMarkdown: instance.setMarkdown,
    refreshSidebar: (redraw?: SidebarRedraw) => {
      // What `main.ts` writes on every transaction (#402): the panel is
      // derived from content, from the predicate the badge uses.
      state.referencesImage = documentReferencesImage(instance.editor);
      return refreshSidebar(state, sidebar, io, redraw);
    },
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar,
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext);
  await actions.openFilePath(DOC);
  expect(sidebar.isVisible()).toBe(true);
});

afterEach(() => {
  instance.destroy();
  host.remove();
  document.querySelector('.dialog-overlay')?.remove();
  document.body.innerHTML = '';
});

function edit(): void {
  instance.editor.commands.insertContentAt(1, 'E');
}

const drawnNames = () =>
  [...document.querySelectorAll('.sidebar-file-entry')].map((el) => el.textContent?.split(' ')[1]);

/** Answer the next dialog by the label a person reads. */
function answerNextDialog(label: string): () => void {
  const observer = new MutationObserver(() => {
    const button = [...document.querySelectorAll('.dialog-overlay button')].find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement | undefined;
    if (!button) return;
    observer.disconnect();
    button.click();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

describe('a save leaves a panel closed by hand closed (#387)', () => {
  it('Save', async () => {
    sidebar.toggle();
    edit();
    await actions.handleSave();
    expect(sidebar.isVisible()).toBe(false);
  });

  it('Save As into the same folder', async () => {
    sidebar.toggle();
    saveAsAnswer = '/doc/copy.md';
    await actions.handleSaveAs();
    expect(disk.has('/doc/copy.md')).toBe(true);
    expect(sidebar.isVisible()).toBe(false);
  });

  it('Save As into another folder with structure of its own', async () => {
    sidebar.toggle();
    saveAsAnswer = '/other/copy.md';
    await actions.handleSaveAs();
    expect(disk.has('/other/copy.md')).toBe(true);
    expect(sidebar.isVisible()).toBe(false);
  });

  it('a reload after an external change', async () => {
    sidebar.toggle();
    edit();
    disk.set(DOC, '# Note, changed elsewhere\n');
    const stop = answerNextDialog('Reload');
    await actions.handleSave();
    stop();
    expect(instance.getMarkdown()).toContain('changed elsewhere');
    expect(sidebar.isVisible()).toBe(false);
  });
});

describe('what still redraws or opens the panel (#387)', () => {
  it('a save redraws an open panel, so a file just written appears in it', async () => {
    folders.set('/doc/assets', ['a.png', 'pasted.png']);
    edit();
    await actions.handleSave();
    expect(sidebar.isVisible()).toBe(true);
    expect(drawnNames()).toEqual(['a.png', 'pasted.png']);
  });

  it('a document arriving opens the panel for its structure, even after a close by hand', async () => {
    sidebar.toggle();
    await actions.openFilePath(OTHER);
    expect(sidebar.isVisible()).toBe(true);
    expect(drawnNames()).toEqual(['z.png']);
  });
});
