/**
 * #731 - a window of its own and other kinds of file, driven through the real
 * route: the link opener of the editor, the resolver of #727, the presence of
 * #729 and the document actions over a real editor, with a disk held in a map
 * and the window and the system recorded where the platform would be called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import { SYSTEM_OPEN_EXTENSIONS } from '../platform/paths';
import type { EntryPresence, FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { installLinkOpener } from './link-open';
import { followRelativeLink, missingTargetMessage, windowFailedMessage } from './relative-link';
import { AppState } from './state';
import {
  notLookedAtMessage,
  notOpenedHereMessage,
  openingMessage,
  refusedKindMessage,
} from './system-hand-over';

const A = '/notes/docs/a.md';
const B = '/notes/docs/b.md';
const TEN_LINKS = SYSTEM_OPEN_EXTENSIONS.map((ext) => `[x.${ext}](x.${ext})`).join(' ');

const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../ui/toast', () => ({ showToast: vi.fn((m: string) => toasts.push(m)) }));

let disk: Map<string, string>;
let folders: Set<string>;
let opensFiles: boolean;
let handed: string[];
let systemFails: boolean;

const io = {
  pathsOutliveSession: true,
  get opensFilesWithSystem() {
    return opensFiles;
  },
  canWriteCompanions: async () => true,
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
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  entryPresence: vi.fn(async (path: string): Promise<EntryPresence> => {
    // As `Path::exists()`: false for what is inside a shut folder.
    if (path.startsWith('/notes/docs/shut/')) return 'absent';
    return disk.has(path) || folders.has(path) ? 'present' : 'absent';
  }),
  listDir: async (path: string): Promise<FileEntry[]> => {
    if (path === '/notes/docs/shut') throw new Error('permission denied');
    return [];
  },
  mkdir: async () => {},
  openWithSystem: vi.fn(async (path: string) => {
    if (systemFails) throw new Error('no application');
    handed.push(path);
  }),
} as unknown as PlatformIO;

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));

const reporter: ErrorReporter = { silent: () => {}, toast: () => {}, dialog: async () => {} };

let state: AppState;
let instance: EditorInstance;
let host: HTMLElement;
let actions: DocumentActions;
let windows: string[];
let windowAnswer: 'opens' | 'web' | 'fails' | 'absent';
let pending: Promise<void>;
let uninstall: () => void;

function deps() {
  return {
    documentPath: () => state.filePath,
    panelRoot: () => null,
    io: async () => io,
    openFilePath: (path: string, root?: string) => actions.openFilePath(path, root),
    openWindow:
      windowAnswer === 'absent'
        ? undefined
        : async (path: string) => {
            if (windowAnswer === 'fails') throw new Error('no process');
            if (windowAnswer === 'web') return false;
            windows.push(path);
            return true;
          },
  };
}

beforeEach(async () => {
  localStorage.clear();
  toasts.length = 0;
  handed = [];
  windows = [];
  windowAnswer = 'opens';
  opensFiles = true;
  systemFails = false;
  disk = new Map([
    [
      A,
      `# Alpha\n\n[b](b.md) [gone](gone.md) [shut](shut/s.md) [up](../other/y.png) [svg](x.svg) [upper](X.PDF) [nopdf](none.pdf) [shutpdf](shut/x.pdf) ${TEN_LINKS}\n`,
    ],
    [B, '# Beta\n'],
    ['/notes/other/y.png', 'png'],
    ['/notes/docs/X.PDF', 'pdf'],
    ['/notes/docs/x.svg', '<svg/>'],
    ...SYSTEM_OPEN_EXTENSIONS.map((ext): [string, string] => [`/notes/docs/x.${ext}`, ext]),
  ]);
  folders = new Set(['/notes', '/notes/docs', '/notes/other', '/notes/docs/shut']);
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
  pending = Promise.resolve();
  uninstall = installLinkOpener(host, {
    openExternal: async () => {},
    openRelative: (address, inNewWindow) => {
      pending = followRelativeLink(deps(), address, inNewWindow);
    },
  });
  vi.mocked(io.entryPresence).mockClear();
});

afterEach(() => {
  uninstall();
  instance.destroy();
  host.remove();
  document.querySelector('.dialog-overlay')?.remove();
});

/** The gesture a person makes on the link whose text is `label`. */
async function gesture(label: string, shift: boolean): Promise<void> {
  const link = [...host.querySelectorAll('a')].find((a) => a.textContent === label);
  if (!link) throw new Error(`no link ${label}`);
  const init = { bubbles: true, cancelable: true, ctrlKey: true, shiftKey: shift, button: 0 };
  link.dispatchEvent(new MouseEvent('mousedown', init));
  link.dispatchEvent(new MouseEvent('click', init));
  await pending;
}

function edit(): void {
  instance.editor.commands.insertContentAt(1, 'EDIT ');
  expect(state.modified).toBe(true);
}

/** The titles of the dialogs put on screen while `run` ran, each answered Discard. */
async function questions(run: () => Promise<void>): Promise<string[]> {
  const asked: string[] = [];
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('.dialog-overlay:not([data-seen])');
    if (!overlay) return;
    overlay.setAttribute('data-seen', '');
    asked.push(overlay.querySelector('.dialog-title')?.textContent ?? '');
    [...overlay.querySelectorAll('button')].find((b) => b.textContent === 'Discard')?.click();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  await run();
  observer.disconnect();
  return asked;
}

describe('Ctrl+Shift+click: a window of its own (#731)', () => {
  it('opens the file in a window of its own, the current document and its edit untouched, no question', async () => {
    edit();
    const asked = await questions(() => gesture('b', true));
    expect(windows).toEqual([B]);
    expect(asked).toEqual([]);
    expect(state.filePath).toBe(A);
    expect(state.modified).toBe(true);
    expect(instance.getMarkdown()).toContain('EDIT');
    expect(handed).toEqual([]);
  });

  it('Ctrl+click without Shift still opens it here, through the question', async () => {
    edit();
    const asked = await questions(() => gesture('b', false));
    expect(asked).toEqual(['Unsaved changes']);
    expect(windows).toEqual([]);
    expect(state.filePath).toBe(B);
  });

  it('the web build falls back to this tab, as Ctrl+click', async () => {
    windowAnswer = 'web';
    edit();
    const asked = await questions(() => gesture('b', true));
    expect(asked).toEqual(['Unsaved changes']);
    expect(state.filePath).toBe(B);
  });

  it('with no window wired, it opens here', async () => {
    windowAnswer = 'absent';
    await gesture('b', true);
    expect(state.filePath).toBe(B);
  });

  it('a missing file is said, and no window opens', async () => {
    await gesture('gone', true);
    expect(windows).toEqual([]);
    expect(toasts).toEqual([missingTargetMessage('/notes/docs/gone.md')]);
    expect(state.filePath).toBe(A);
  });

  it('a file in a folder AgentEd cannot look in is said, and no window opens', async () => {
    await gesture('shut', true);
    expect(windows).toEqual([]);
    expect(toasts).toEqual([notLookedAtMessage('/notes/docs/shut/s.md')]);
    expect(state.filePath).toBe(A);
  });

  it('a window that does not start is said, the document untouched', async () => {
    windowAnswer = 'fails';
    await gesture('b', true);
    expect(toasts).toEqual([windowFailedMessage(B)]);
    expect(state.filePath).toBe(A);
  });
});

describe('Ctrl+click on another kind of file: the system (#731)', () => {
  it.each(SYSTEM_OPEN_EXTENSIONS)(
    'x.%s, found present, is handed over, the message naming it',
    async (ext) => {
      await gesture(`x.${ext}`, false);
      expect(handed).toEqual([`/notes/docs/x.${ext}`]);
      expect(toasts).toEqual([openingMessage(`/notes/docs/x.${ext}`)]);
      expect(state.filePath).toBe(A);
    },
  );

  it('an extension in capitals is one of the ten', async () => {
    await gesture('upper', false);
    expect(handed).toEqual(['/notes/docs/X.PDF']);
  });

  it('with Shift too, since a window of its own is for markdown files', async () => {
    await gesture('x.pdf', true);
    expect(handed).toEqual(['/notes/docs/x.pdf']);
    expect(windows).toEqual([]);
  });

  it('a file outside the ten is refused in the words of the files panel, the disk not asked', async () => {
    await gesture('svg', false);
    expect(handed).toEqual([]);
    expect(toasts).toEqual([refusedKindMessage('/notes/docs/x.svg')]);
    expect(io.entryPresence).not.toHaveBeenCalled();
  });

  it('an absent file is said, naming it, and nothing is handed over', async () => {
    await gesture('nopdf', false);
    expect(handed).toEqual([]);
    expect(toasts).toEqual([missingTargetMessage('/notes/docs/none.pdf')]);
  });

  it('a file whose presence is unknown hands nothing and says why', async () => {
    await gesture('shutpdf', false);
    expect(handed).toEqual([]);
    expect(toasts).toEqual([notLookedAtMessage('/notes/docs/shut/x.pdf')]);
  });

  it('a path from .. is handed as the resolver built it', async () => {
    await gesture('up', false);
    expect(handed).toEqual(['/notes/other/y.png']);
  });

  it('the web build hands nothing, and says so as #727 did', async () => {
    opensFiles = false;
    await gesture('x.pdf', false);
    expect(handed).toEqual([]);
    expect(toasts).toEqual([notOpenedHereMessage('/notes/docs/x.pdf')]);
  });

  it('a system that cannot open it is told in the error toast of the files panel', async () => {
    systemFails = true;
    await gesture('x.pdf', false);
    expect(toasts).toEqual(['Could not open x.pdf.']);
  });
});

describe('the words, each naming the file (#731)', () => {
  it('reads as proposed on the pull request', () => {
    expect(openingMessage('/n/x.pdf')).toBe('Opening x.pdf with the system viewer…');
    expect(notLookedAtMessage('/n/x.pdf')).toBe(
      'AgentEd could not look in the folder of x.pdf, so it is not opened.',
    );
    expect(refusedKindMessage('/n/x.svg')).toBe('Could not open x.svg.');
    expect(windowFailedMessage('/n/b.md')).toBe('b.md could not be opened in a window of its own.');
    expect(missingTargetMessage('/n/none.pdf')).toBe('none.pdf was not found.');
  });
});
