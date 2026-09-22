/**
 * Issue #51 — how long an `assets/` agreement lives.
 *
 * The owner's answer, 2026-08-24: it belongs to the **folder**, and it
 * lives as long as the window does (R-C5). Two documents in one folder
 * are one question, whether the second arrived by Open or by New.
 *
 * These tests drive the **real** paths rather than arranging state by
 * hand, which is what the issue asks for and what nothing in the suite
 * did before it: the agreement is won through `handleImageFile`, the
 * second document arrives through `openFilePath` — and therefore
 * through `loadDocument` and `applyLoadedDocument` — and the second insert goes
 * through `handleImageFile` again. A test that set
 * `assetsDirConfirmedFor` directly would pass with the open path
 * deleted.
 */
import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages, getAllImages } from '../editor/image-registry';
import type { FileEntry, PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { showToast } from '../ui/toast';
import { confirmAssetsDir } from './assets-dir';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import { createImageInsertReporter } from './image-insert-report';
import { AppState } from './state';

vi.mock('../platform/detect', () => ({ isTauri: true }));
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/** What the fake save picker will answer next, in order. */
let savePaths: string[] = [];
/** Contents of the documents this fake disk holds. */
const files = new Map<string, string>([
  ['/X/a.md', '# A\n'],
  ['/X/b.md', '# B\n'],
  ['/Y/b.md', '# Y B\n'],
]);

const io: PlatformIO = {
  // Desktop-shaped: every path carries a directory (#46).
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  saveFile: async () => {},
  readSnapshot: async () => ({ kind: 'absent' as const }),
  pickSavePath: async () => savePaths.shift() ?? null,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  // Nothing exists: no `assets/` anywhere, so the consent can never be
  // inferred from the disk and has to come from what was remembered.
  // R-C5 uses an existing folder without asking at all, which would
  // hide the behaviour under test.
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: async () => {},
};

/**
 * The AppContext fields `openFilePath`, `handleNew` and `requestSaveAs`
 * actually touch. Everything else stays undefined — a field that turns
 * out to be needed fails loudly rather than being quietly stubbed.
 */
function makeCtx(state: AppState): AppContext {
  return {
    state,
    reporter: { dialog: vi.fn(async () => {}) },
    setMarkdown: vi.fn(),
    getMarkdown: () => '',
    statusbar: { refresh: vi.fn() },
    sidebar: { hide: vi.fn() },
    frontmatterPanel: { refresh: vi.fn(), setVisible: vi.fn() },
    refreshSidebar: vi.fn(async () => {}),
    setFilename: vi.fn(),
    updateCloseEnabled: vi.fn(),
  } as unknown as AppContext;
}

function stubEditor(): Editor {
  const setImage = vi.fn(() => ({ run: vi.fn() }));
  const focus = vi.fn(() => ({ setImage }));
  return { chain: vi.fn(() => ({ focus })) } as unknown as Editor;
}

/**
 * `seed` makes each image genuinely distinct: identical bytes are one
 * picture and are stored once (#52), so a repeated fixture would prove
 * nothing about a *second* insert.
 */
function imageFile(name: string, seed: number): File {
  const data = Uint8Array.from({ length: 8 }, (_, i) => seed * 16 + i);
  return {
    size: data.length,
    type: 'image/png',
    name,
    arrayBuffer: async () => data.slice().buffer,
  } as unknown as File;
}

/**
 * Insert one image exactly as `main.ts` wires the flow: the current path
 * if there is one, the save picker if there is not, then the real
 * consent function against the real state.
 */
async function insertImage(
  ctx: AppContext,
  actions: DocumentActions,
  name: string,
  seed: number,
): Promise<void> {
  const { handleImageFile } = await import('../editor/image-handler');
  await handleImageFile(
    imageFile(name, seed),
    stubEditor(),
    () => ctx.state.filePath,
    () => actions.requestSaveAs(),
    async () => {
      const path = ctx.state.filePath;
      if (!path) return null;
      return confirmAssetsDir(path, io, ctx.state);
    },
    async () => true,
    'file',
    createImageInsertReporter(ctx.state),
  );
}

function setup(): { state: AppState; ctx: AppContext; actions: DocumentActions } {
  const state = new AppState();
  const ctx = makeCtx(state);
  return { state, ctx, actions: createDocumentActions(ctx) };
}

describe('#51 — an assets/ agreement belongs to the folder (R-C5)', () => {
  beforeEach(() => {
    savePaths = [];
    clearImages();
    localStorage.clear();
    vi.mocked(showConfirmDialog).mockReset();
    vi.mocked(showToast).mockReset();
  });

  it('opening another document in an agreed folder does not ask again', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const { state, ctx, actions } = setup();

    // A never-saved document. The insert asks where it should live, the
    // picker answers /X/a.md, and the user agrees to /X/assets.
    savePaths = ['/X/a.md'];
    await insertImage(ctx, actions, 'first.png', 1);
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(state.assetsDirConfirmedFor).toBe('/X/assets');

    // The real open path: loadDocument + applyLoadedDocument, not a hand-built
    // state. This is the step the issue is about.
    await actions.openFilePath('/X/b.md');
    expect(state.filePath).toBe('/X/b.md');

    // A different document, the same folder. No second question.
    clearImages();
    await insertImage(ctx, actions, 'second.png', 2);

    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(state.assetsDirConfirmedFor).toBe('/X/assets');
    expect(getAllImages()).toHaveLength(1);
    expect(getAllImages()[0]?.relativePath).toBe('assets/second.png');
  });

  it('a new document whose destination lands in an agreed folder does not ask', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const { state, ctx, actions } = setup();

    savePaths = ['/X/a.md'];
    await insertImage(ctx, actions, 'first.png', 1);
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);

    // New — the document is replaced, and with it every per-document
    // field. The folder's answer is not one of them (#51).
    await actions.handleNew();
    expect(state.filePath).toBeNull();

    clearImages();
    savePaths = ['/X/c.md'];
    await insertImage(ctx, actions, 'second.png', 2);

    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(getAllImages()).toHaveLength(1);
  });

  it('opening a document in a folder never agreed to still asks', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const { state, ctx, actions } = setup();

    savePaths = ['/X/a.md'];
    await insertImage(ctx, actions, 'first.png', 1);

    // A different folder is a different question — the promise is per
    // folder, and this is the half that keeps it from being per session.
    await actions.openFilePath('/Y/b.md');
    clearImages();
    await insertImage(ctx, actions, 'second.png', 2);

    expect(showConfirmDialog).toHaveBeenCalledTimes(2);
    expect(state.assetsDirConfirmedFor).toBe('/Y/assets');
  });

  it('a Save As into a folder never agreed to asks again', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const { state, ctx, actions } = setup();

    savePaths = ['/X/a.md'];
    await insertImage(ctx, actions, 'first.png', 1);
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);

    // The neighbouring property, driven through the real requestSaveAs
    // rather than by handing confirmAssetsDir two different paths —
    // `assets-dir.test.ts` already pins it at that level.
    savePaths = ['/Y/a.md'];
    expect(await actions.requestSaveAs()).toBe('/Y/a.md');

    clearImages();
    await insertImage(ctx, actions, 'second.png', 2);

    expect(showConfirmDialog).toHaveBeenCalledTimes(2);
    expect(state.assetsDirConfirmedFor).toBe('/Y/assets');
  });
});

/**
 * #48's cue travels the other way, and must keep travelling that way
 * whatever happens to the consent above: it explains *this* document's
 * silence, so a new document has its own to explain.
 */
describe('#48 — the destination cue stays per document', () => {
  beforeEach(() => {
    savePaths = [];
    clearImages();
    localStorage.clear();
    vi.mocked(showConfirmDialog).mockReset();
    vi.mocked(showToast).mockReset();
  });

  it('New clears it, so the next document is told once too', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const { state, ctx, actions } = setup();

    savePaths = ['/X/a.md'];
    await insertImage(ctx, actions, 'first.png', 1);
    expect(state.destinationCueShown).toBe(true);
    expect(showToast).toHaveBeenCalledTimes(1);

    await actions.handleNew();
    expect(state.destinationCueShown).toBe(false);

    // And the new document does get told — the flag was cleared, not
    // merely reported as cleared.
    clearImages();
    savePaths = ['/X/c.md'];
    await insertImage(ctx, actions, 'second.png', 2);
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it('New from Template clears it too', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const { state, ctx, actions } = setup();

    savePaths = ['/X/a.md'];
    await insertImage(ctx, actions, 'first.png', 1);
    expect(state.destinationCueShown).toBe(true);

    await actions.handleNewFromTemplate('blank-frontmatter');
    expect(state.destinationCueShown).toBe(false);
  });

  /**
   * The reading #51 offers about the cue, held by a test instead of by
   * two lines of source: `applyLoadedDocument` does not clear
   * `destinationCueShown` either, and that is harmless for a stronger
   * reason than routing — `showDestinationCue` returns early on
   * `!isFirstSave`, and `applyLoadedDocument` sets `isFirstSave` to false, so
   * the cue cannot fire on an opened document at all.
   *
   * The flag is forced to `false` before the insert on purpose: with it
   * left `true` the test would pass whichever of the two guards was
   * doing the work.
   */
  it('cannot fire on an opened document, whatever the flag says', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    const { state, ctx, actions } = setup();

    await actions.openFilePath('/X/b.md');
    expect(state.isFirstSave).toBe(false);
    state.destinationCueShown = false;

    await insertImage(ctx, actions, 'first.png', 1);

    // The image landed; the cue did not fire, and the flag was not even
    // spent — there was nothing to explain.
    expect(getAllImages()).toHaveLength(1);
    expect(showToast).not.toHaveBeenCalled();
    expect(state.destinationCueShown).toBe(false);
  });
});
