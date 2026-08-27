/**
 * Issue #144 — Save As used to write to the granted folder root rather
 * than to the file the user picked.
 *
 * `pickSavePath` answered `handle.name`, a bare name carrying no folder,
 * and `resolveOrCreateFileHandle` consults the granted directory before
 * the single-file fallback. So once any grant existed, the save handle
 * chosen in the dialog was never used again and the bytes went to a file
 * of that name at the grant root — creating one where none was there,
 * and overwriting one where there was.
 *
 * **R-C14 names a protection that did not cover the file being written.**
 * A Save As destination is exempt from the external-change check because
 * *that path is protected by the save picker's own replace question*. The
 * picker asked about `A/doc/report.md`; the bytes went to `A/report.md`,
 * which nothing asked about at any point. That is the silent overwrite
 * R-C14 and Q4 exist to prevent.
 *
 * Measured at `3e276ee`, over this same harness, before the change:
 *
 * | state | wrote | the picked file |
 * | --- | --- | --- |
 * | grant `A`, into `A/doc`, folder picker cancelled | `A/report.md` | untouched |
 * | grant `A`, into `A/doc`, user grants `A` again | `A/report.md` | untouched |
 * | grant `A`, into another tree `B` | `A/report.md` | untouched |
 * | no grant, into `B` | `B/report.md` — correct | correct |
 * | first-ever Save As into `A/doc`, then granting `A` | `A/report.md`, created | left empty |
 *
 * These drive the **real** `WebIO` with handles constructed, through the
 * **real** Save As route — `handleSaveAs` → `requestSaveAs` →
 * `pickSavePath` → `persistBundle` → `saveFile`. A fake IO passes with the
 * whole change reverted, because the defect is the platform's name
 * resolution.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectContextCluster } from '../cluster/detector';
import { WebIO } from '../platform/web';
import { resolveAssetsDir } from './assets-dir';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import { shouldShowSidebar } from './sidebar-sync';
import { AppState } from './state';

const DOCUMENT = '# the document the user is saving\n';
const AT_GRANT_ROOT = '# a different document, already at the grant root\n';
const IN_SUBFOLDER = '# whatever the destination held before\n';

let io: WebIO;

vi.mock('../platform/detect', () => ({ isTauri: false }));
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn(async () => null) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

// ── A file system built from handles ──

interface StubFile extends FileSystemFileHandle {
  /** What this file holds right now — where a save landing wrong is visible. */
  current(): string;
}

function fileHandle(name: string, initial: string): StubFile {
  let text = initial;
  return {
    kind: 'file',
    name,
    getFile: async () =>
      ({
        text: async () => text,
        arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
      }) as unknown as File,
    createWritable: async () =>
      ({
        write: async (data: unknown) => {
          text = String(data);
        },
        close: async () => {},
      }) as unknown as FileSystemWritableFileStream,
    current: () => text,
  } as StubFile;
}

type Tree = { [name: string]: string | Tree };

interface StubDir extends FileSystemDirectoryHandle {
  files: Map<string, StubFile>;
  dirs: Map<string, StubDir>;
}

/**
 * `getFileHandle` rejects with `NotFoundError` for an entry that is not
 * there and creates one on `{ create: true }` — the pair that let a save
 * invent a file at the grant root.
 */
function dirHandle(name: string, tree: Tree): StubDir {
  const files = new Map<string, StubFile>();
  const dirs = new Map<string, StubDir>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') files.set(key, fileHandle(key, value));
    else dirs.set(key, dirHandle(key, value));
  }
  const dir = {
    kind: 'directory',
    name,
    files,
    dirs,
    getFileHandle: async (n: string, options?: { create?: boolean }) => {
      const existing = files.get(n);
      if (existing) return existing;
      if (!options?.create) throw new DOMException('stub: no entry', 'NotFoundError');
      const created = fileHandle(n, '');
      files.set(n, created);
      return created;
    },
    getDirectoryHandle: async (n: string, options?: { create?: boolean }) => {
      const existing = dirs.get(n);
      if (existing) return existing;
      if (!options?.create) throw new DOMException('stub: no entry', 'NotFoundError');
      const created = dirHandle(n, {});
      dirs.set(n, created);
      return created;
    },
    values: () => {
      const all = [...files.values(), ...dirs.values()];
      let i = 0;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next: async () =>
          i >= all.length
            ? { done: true as const, value: undefined }
            : { done: false as const, value: all[i++] },
      };
    },
    removeEntry: async () => {},
    /** The components down to a descendant, `null` for a handle that is not one. */
    resolve: async (descendant: FileSystemHandle) => {
      function find(current: StubDir, prefix: string[]): string[] | null {
        for (const file of current.files.values()) {
          if (file === descendant) return [...prefix, file.name];
        }
        for (const sub of current.dirs.values()) {
          if (sub === descendant) return [...prefix, sub.name];
          const deeper = find(sub, [...prefix, sub.name]);
          if (deeper) return deeper;
        }
        return null;
      }
      return find(dir, []);
    },
  } as unknown as StubDir;
  return dir;
}

/** Put a destination in front of the save picker, and an answer in front of the folder one. */
function pickers(destination: StubFile, folderAnswer: StubDir | 'cancel'): void {
  (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn(
    async () => destination,
  );
  (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = vi.fn(async () => {
    if (folderAnswer === 'cancel') throw new DOMException('stub: cancelled', 'AbortError');
    return folderAnswer;
  });
}

// ── The application around it ──

function makeCtx(state: AppState): AppContext {
  return {
    state,
    reporter: { dialog: vi.fn(async () => {}) },
    editor: { commands: { clearContent: vi.fn() } },
    setMarkdown: vi.fn(),
    getMarkdown: () => DOCUMENT,
    statusbar: { refresh: vi.fn() },
    sidebar: { hide: vi.fn(), showTree: vi.fn() },
    frontmatterPanel: { refresh: vi.fn(), setVisible: vi.fn() },
    refreshSidebar: vi.fn(async () => {}),
    setFilename: vi.fn(),
    updateCloseEnabled: vi.fn(),
  } as unknown as AppContext;
}

/**
 * The five states this defect was measured in. `grant` is what the
 * session already holds; `folderAnswer` is what the directory picker
 * does when `pickSavePath` opens it in the same gesture.
 */
interface Scenario {
  state: AppState;
  actions: DocumentActions;
  /** The file the save picker returned — the one the user chose. */
  destination: StubFile;
  /** The granted folder, once the gesture is over. */
  grant: StubDir;
  /** A file of the same name sitting at the grant root, when the state has one. */
  atGrantRoot: StubFile | null;
}

function scenario(which: 1 | 2 | 3 | 4 | 5): Scenario {
  let grant: StubDir;
  let destination: StubFile;
  let held: StubDir | null;
  let folderAnswer: StubDir | 'cancel';

  if (which === 1 || which === 2) {
    // Grant on A, destination inside A/doc, with a same-named file at A's root.
    grant = dirHandle('A', { doc: { 'report.md': IN_SUBFOLDER }, 'report.md': AT_GRANT_ROOT });
    destination = grant.dirs.get('doc')?.files.get('report.md') as StubFile;
    held = grant;
    folderAnswer = which === 1 ? 'cancel' : grant;
  } else if (which === 3) {
    // Grant on A, destination in a different tree entirely.
    grant = dirHandle('A', { 'report.md': AT_GRANT_ROOT });
    const elsewhere = dirHandle('B', { 'report.md': IN_SUBFOLDER });
    destination = elsewhere.files.get('report.md') as StubFile;
    held = grant;
    folderAnswer = 'cancel';
  } else if (which === 4) {
    // No grant at all — the state the single-file fallback was written for.
    grant = dirHandle('A', {});
    const elsewhere = dirHandle('B', { 'report.md': IN_SUBFOLDER });
    destination = elsewhere.files.get('report.md') as StubFile;
    held = null;
    folderAnswer = 'cancel';
  } else {
    // The ordinary first save: no grant yet, destination in a subfolder,
    // and the folder above it granted in the same gesture.
    grant = dirHandle('A', { doc: { 'report.md': '' }, 'AGENTS.md': 'root context' });
    (grant.dirs.get('doc') as StubDir).files.set('AGENTS.md', fileHandle('AGENTS.md', 'context'));
    destination = grant.dirs.get('doc')?.files.get('report.md') as StubFile;
    held = null;
    folderAnswer = grant;
  }

  io = new WebIO();
  if (held) (io as unknown as { dirHandle: unknown }).dirHandle = held;
  pickers(destination, folderAnswer);

  const state = new AppState();
  const ctx = makeCtx(state);
  return {
    state,
    actions: createDocumentActions(ctx),
    destination,
    grant,
    atGrantRoot: grant.files.get('report.md') ?? null,
  };
}

const LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'grant on A, into A/doc, folder picker cancelled',
  2: 'grant on A, into A/doc, user grants A again',
  3: 'grant on A, into another tree B',
  4: 'no grant, into B',
  5: 'first-ever Save As into A/doc, then granting A',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('#144 — the bytes land in the file the user picked', () => {
  for (const which of [1, 2, 3, 4, 5] as const) {
    it(`${LABELS[which]}`, async () => {
      const { actions, destination } = scenario(which);

      await actions.handleSaveAs();

      expect(destination.current()).toBe(DOCUMENT);
    });

    it(`${LABELS[which]} — and nothing at the grant root is written or invented`, async () => {
      const { actions, grant, atGrantRoot } = scenario(which);
      const before = atGrantRoot?.current() ?? null;

      await actions.handleSaveAs();

      if (before === null) {
        // States 4 and 5 have no file of that name at the grant root.
        // The old code created one; nothing may create one now.
        expect(grant.files.has('report.md')).toBe(false);
      } else {
        expect(atGrantRoot?.current()).toBe(before);
      }
    });
  }
});

describe('#144 — the path answered names the file that was written', () => {
  it('a destination inside the granted folder is named by the grant', async () => {
    // The measurement that chose where `pathWithinGrant` is asked (#144
    // M2): asked before the folder picker, this state answers `report.md`
    // and everything built with `dirname` is then computed for the grant
    // root. Asked after it, the answer carries the parent.
    const { state, actions } = scenario(5);

    await actions.handleSaveAs();

    expect(state.filePath).toBe('doc/report.md');
  });

  it('a destination outside it has no such path, and keeps its own name', async () => {
    const { state, actions } = scenario(3);

    await actions.handleSaveAs();

    expect(state.filePath).toBe('report.md');
  });

  it('R-C14 then compares against the file that was written', async () => {
    // The baseline is cleared by `requestSaveAs`, so the first save is
    // not asked about. The save *after* it must find the destination
    // rather than a same-named neighbour, or the user is shown a
    // conflict about a document they never chose.
    const { state, actions, destination } = scenario(1);

    await actions.handleSaveAs();

    const snapshot = await io.readSnapshot(state.filePath ?? '');
    expect(snapshot).toEqual({ kind: 'file', text: DOCUMENT });
    expect(destination.current()).toBe(DOCUMENT);
  });
});

describe('#144 — what is computed from the path afterwards', () => {
  // Rows 5 to 13 of the table in #143: `assets/`, the sidebar root and
  // the context scan are all built from `dirname` of the answered path.
  // They are what make this one defect rather than one wrong write.
  it('assets/ goes beside the document, not beside the grant root', async () => {
    const { state, actions } = scenario(5);

    await actions.handleSaveAs();

    await expect(resolveAssetsDir(state.filePath ?? '', io)).resolves.toEqual({
      dir: 'doc/assets',
      exists: false,
    });
  });

  it('the sidebar root is looked for beside the document', async () => {
    const { state, actions, grant } = scenario(5);
    (grant.dirs.get('doc') as StubDir).dirs.set('assets', dirHandle('assets', {}));

    await actions.handleSaveAs();

    await expect(shouldShowSidebar(state.filePath, io)).resolves.toEqual({
      show: true,
      root: 'doc/assets',
    });
  });

  it('the context scan reads the document folder, not the grant root', async () => {
    const { state, actions } = scenario(5);

    await actions.handleSaveAs();
    const cluster = await detectContextCluster(state.filePath ?? '', io, { timeoutMs: 200 });

    expect(cluster.entries.map((e) => e.path)).toEqual(['doc/AGENTS.md']);
  });
});

describe('#144 — Save As still re-anchors the document', () => {
  it('a file opened from outside the grant no longer shadows the destination', async () => {
    // The property #142 established, and the one this change is most
    // likely to lose: the registration is now written by both pickers, so
    // a Save As that failed to replace it would leave the previous
    // document's handle answering for the destination's name.
    const grant = dirHandle('A', { 'report.md': AT_GRANT_ROOT });
    const elsewhere = dirHandle('B', { 'report.md': IN_SUBFOLDER });
    const opened = elsewhere.files.get('report.md') as StubFile;
    const destination = grant.files.get('report.md') as StubFile;

    io = new WebIO();
    (io as unknown as { dirHandle: unknown }).dirHandle = grant;
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn(async () => [
      opened,
    ]);

    const state = new AppState();
    const actions = createDocumentActions(makeCtx(state));

    await actions.handleOpen();
    expect(state.filePath).toBe('report.md');
    await expect(io.readText('report.md')).resolves.toBe(IN_SUBFOLDER);

    pickers(destination, grant);
    await actions.handleSaveAs();

    expect(destination.current()).toBe(DOCUMENT);
    expect(opened.current()).toBe(IN_SUBFOLDER);
  });
});
