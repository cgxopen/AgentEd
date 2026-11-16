/**
 * #727 - Ctrl+click on a relative link, driven through the real route: the
 * link opener of the editor, the resolver, and the document actions over a
 * real editor with a disk held in a map, the harness of
 * `recent-files-flow.test.ts`. The question about unsaved changes is the real
 * dialog, answered by the label a person reads. Each outcome is set against a
 * click in the files panel on the same file: the document opened, the root
 * the panel is told to keep (R-C6), the recent files list (R-C3) and the text
 * loaded (R-C16).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { EntryPresence, FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { loadRecentFiles } from '../preferences';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { installLinkOpener } from './link-open';
import {
  followRelativeLink,
  missingTargetMessage,
  NO_FOLDER_ACCESS_MESSAGE,
  notMarkdownMessage,
  RELATIVE_LINK_MESSAGES,
} from './relative-link';
import { createSidebarClickHandler } from './sidebar-click';
import { AppState } from './state';

const ROOT = '/notes';
const A = '/notes/docs/a.md';
const B = '/notes/docs/b.md';
const C = '/notes/c.md';

const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../ui/toast', () => ({ showToast: vi.fn((m: string) => toasts.push(m)) }));

let disk: Map<string, string>;
let folders: Set<string>;
let documentUnknown: boolean;

const io: PlatformIO = {
  pathsOutliveSession: true,
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
  entryPresence: async (path: string): Promise<EntryPresence> => {
    if (documentUnknown) return 'unknown';
    return disk.has(path) || folders.has(path) ? 'present' : 'absent';
  },
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: vi.fn(async () => {}),
} as unknown as PlatformIO;

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));

const reporter: ErrorReporter = { silent: () => {}, toast: () => {}, dialog: async () => {} };

let state: AppState;
let instance: EditorInstance;
let host: HTMLElement;
let actions: DocumentActions;
let panelRoot: string | null;
let opened: Array<{ path: string; root: string | undefined }>;
let uninstall: () => void;

/** The deps the application passes, with `openFilePath` recorded on its way to the real one. */
function deps() {
  return {
    documentPath: () => state.filePath,
    panelRoot: () => panelRoot,
    io: async () => io,
    openFilePath: (path: string, root?: string) => {
      opened.push({ path, root });
      return actions.openFilePath(path, root);
    },
  };
}

beforeEach(async () => {
  localStorage.clear();
  toasts.length = 0;
  disk = new Map([
    [
      A,
      '# Alpha\n\n[b](b.md) [c](../c.md) [pdf](x.pdf) [anchor](#h) [rooted](/a.md) [folder](sub/) [gone](gone.md) [above](../../../x.md)\n',
    ],
    [B, '# Beta\n'],
    [C, '# Gamma\n'],
    ['/notes/docs/x.pdf', '%PDF'],
  ]);
  folders = new Set([ROOT, '/notes/docs', '/notes/docs/sub']);
  documentUnknown = false;
  panelRoot = ROOT;
  opened = [];
  clearImages();
  state = new AppState();
  host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host, () => state.setModified(true));
  actions = createDocumentActions({
    state,
    reporter,
    editor: instance.editor,
    getMarkdown: instance.getMarkdown,
    setMarkdown: instance.setMarkdown,
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext);
  await actions.openFilePath(A);
  uninstall = installLinkOpener(host, {
    openExternal: async () => {},
    openRelative: (address) => {
      pending = followRelativeLink(deps(), address);
    },
  });
});

let pending: Promise<void> = Promise.resolve();

afterEach(() => {
  uninstall();
  instance.destroy();
  host.remove();
  document.querySelector('.dialog-overlay')?.remove();
});

/** Ctrl+click on the link whose text is `label`, the gesture a person makes. */
async function ctrlClick(label: string): Promise<void> {
  const link = [...host.querySelectorAll('a')].find((a) => a.textContent === label);
  if (!link) throw new Error(`no link ${label}`);
  link.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }),
  );
  link.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }),
  );
  await pending;
}

/** The titles of the confirm dialogs put on screen while `run` ran, each answered. */
async function gateQuestions(run: () => Promise<void>, answer = 'Discard'): Promise<string[]> {
  const asked: string[] = [];
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('.dialog-overlay:not([data-seen])');
    if (!overlay) return;
    overlay.setAttribute('data-seen', '');
    asked.push(overlay.querySelector('.dialog-title')?.textContent ?? '');
    [...overlay.querySelectorAll('button')].find((b) => b.textContent === answer)?.click();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  await run();
  observer.disconnect();
  return asked;
}

function edit(): void {
  instance.editor.commands.insertContentAt(1, 'EDIT ');
  expect(state.modified).toBe(true);
}

describe('a relative link to a markdown file opens it, as a click in the panel does (#727)', () => {
  it('through the question about unsaved changes, and the file is opened when the answer lets it', async () => {
    edit();
    const asked = await gateQuestions(() => ctrlClick('b'));
    expect(asked).toEqual(['Unsaved changes']);
    expect(state.filePath).toBe(B);
    expect(instance.getMarkdown()).toContain('Beta');
  });

  it('a Cancel at the question keeps the document and its edit', async () => {
    edit();
    const asked = await gateQuestions(() => ctrlClick('b'), 'Cancel');
    expect(asked).toEqual(['Unsaved changes']);
    expect(state.filePath).toBe(A);
    expect(instance.getMarkdown()).toContain('EDIT');
  });

  it('the panel root, the recent files list and the text loaded are those of a click in the panel', async () => {
    await ctrlClick('c');
    const byLink = {
      path: state.filePath,
      root: opened[0]?.root,
      recent: loadRecentFiles(),
      text: instance.getMarkdown(),
    };

    localStorage.clear();
    await actions.openFilePath(A);
    const panelOpened: Array<string | undefined> = [];
    const click = createSidebarClickHandler(
      {
        ...actions,
        openFilePath: (path: string, root?: string) => {
          panelOpened.push(root);
          return actions.openFilePath(path, root);
        },
      },
      async () => io,
    );
    click(C, ROOT);
    await vi.waitFor(() => expect(state.filePath).toBe(C));
    const byPanel = {
      path: state.filePath,
      root: panelOpened[0],
      recent: loadRecentFiles(),
      text: instance.getMarkdown(),
    };

    expect(byLink).toEqual(byPanel);
    expect(byLink.root).toBe(ROOT);
  });

  it('with the panel showing no tree, no root is kept, as no click in the panel could be made', async () => {
    panelRoot = null;
    await ctrlClick('c');
    expect(opened).toEqual([{ path: C, root: undefined }]);
  });

  it('a target outside the root the panel lists is opened with no root kept', async () => {
    panelRoot = '/notes/docs/sub';
    await ctrlClick('b');
    expect(opened).toEqual([{ path: B, root: undefined }]);
  });
});

describe('what a relative link that is not followed says (#727)', () => {
  it.each([
    ['pdf', notMarkdownMessage('/notes/docs/x.pdf')],
    ['anchor', RELATIVE_LINK_MESSAGES['anchor-only']],
    ['rooted', RELATIVE_LINK_MESSAGES.rooted],
    ['folder', RELATIVE_LINK_MESSAGES.folder],
    ['gone', missingTargetMessage('/notes/docs/gone.md')],
    ['above', RELATIVE_LINK_MESSAGES['above-root']],
  ])('%s', async (label, message) => {
    await ctrlClick(label);
    expect(toasts).toEqual([message]);
    expect(opened).toEqual([]);
    expect(state.filePath).toBe(A);
    expect(io.openWithSystem).not.toHaveBeenCalled();
  });

  it('a document never saved', async () => {
    await followRelativeLink({ ...deps(), documentPath: () => null }, 'b.md');
    expect(toasts).toEqual([RELATIVE_LINK_MESSAGES['no-document']]);
    expect(opened).toEqual([]);
  });

  it('the web build with no folder granted', async () => {
    documentUnknown = true;
    await ctrlClick('b');
    expect(toasts).toEqual([NO_FOLDER_ACCESS_MESSAGE]);
    expect(opened).toEqual([]);
  });

  it('the words name the file where there is one, one sentence each', () => {
    expect(missingTargetMessage('/notes/docs/gone.md')).toBe('gone.md was not found.');
    expect(notMarkdownMessage('/notes/docs/x.pdf')).toMatch(/^x\.pdf /);
    const all = [
      ...Object.values(RELATIVE_LINK_MESSAGES).filter((m) => m !== ''),
      NO_FOLDER_ACCESS_MESSAGE,
      missingTargetMessage(B),
      notMarkdownMessage('/x.pdf'),
    ];
    for (const message of all) expect(message.match(/[.!?](\s|$)/g)?.length, message).toBe(1);
  });
});
