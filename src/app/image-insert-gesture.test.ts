/**
 * One gesture, several images (#66, and the reading recorded on #65).
 *
 * Separate from `image-insert-report.test.ts` because it must use the
 * **real** `showConfirmDialog`: the question here is what happens when
 * several inserts ask for the same consent at once, and a mocked dialog
 * has none of the behaviour that decides the answer. Dialogs are
 * answered by clicking the button a user would click.
 *
 * The numbers below were measured on `main` before #66 as well, and are
 * identical — removing the remembered refusal changed none of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageInsertOutcome } from '../editor/image-insert-outcome';
import { clearImages, getAllImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, PlatformIO } from '../platform/types';
import { confirmAssetsDir } from './assets-dir';
import { AppState } from './state';

const io: PlatformIO = {
  supportsMultiFile: true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async () => '',
  saveFile: async () => {},
  pickSavePath: async () => null,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array([1, 2, 3]),
  writeBinary: async () => {},
  exists: async () => false,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  remove: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/detect', () => ({ isTauri: true }));
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));

let state: AppState;
let reported: ImageInsertOutcome[];
let dialogsSeen: number;

function makeImage(name: string, seed: number): File {
  const data = Uint8Array.from({ length: 8 }, (_, i) => (seed * 31 + i) % 251);
  return {
    size: data.length,
    type: 'image/png',
    name,
    arrayBuffer: async () => data.slice().buffer,
  } as unknown as File;
}

/** Answer every dialog that appears, counting them, as a user clicking would. */
function answerDialogsWith(label: 'Continue' | 'Cancel'): () => void {
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('.dialog-overlay');
    if (!overlay) return;
    dialogsSeen++;
    const button = Array.from(overlay.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === label,
    );
    button?.click();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** An editor wired for images the way `main.ts` wires it. */
function wiredEditor(): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return createEditor(host, undefined, {
    getFilePath: () => state.filePath,
    requestSaveAs: async () => {
      state.filePath = '/doc/notes.md';
      return state.filePath;
    },
    confirmAssetsDir: async () => {
      const path = state.filePath;
      if (!path) return null;
      return confirmAssetsDir(path, io, state);
    },
    report: (outcome) => reported.push(outcome),
  });
}

/** One paste carrying several image files, as the browser delivers it. */
function pasteImages(instance: EditorInstance, files: File[]): void {
  const event = {
    clipboardData: { files, types: ['Files'], getData: () => '' },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = instance.editor;
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

describe('one paste carrying three images', () => {
  beforeEach(() => {
    state = new AppState();
    state.filePath = '/doc/notes.md';
    state.isFirstSave = false;
    reported = [];
    dialogsSeen = 0;
    clearImages();
    for (const el of document.querySelectorAll('.dialog-overlay')) el.remove();
  });

  it('asks once for the gesture, not once per image (#66)', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor();

    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2), makeImage('c.png', 3)]);
    await vi.waitFor(() => expect(reported).toHaveLength(3));
    stop();

    expect(dialogsSeen).toBe(1);
  });

  it('drops the images that arrived while the dialog was open — #65, not #66', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor();

    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2), makeImage('c.png', 3)]);
    await vi.waitFor(() => expect(reported).toHaveLength(3));
    stop();

    // Not the behaviour anyone wants, and deliberately pinned rather than
    // hidden. The insert loop fires one `handleImageFile` per file without
    // awaiting, so the second and third inserts ask for the same consent
    // while the first dialog is still open; `showConfirmDialog` refuses a
    // concurrent dialog and answers `null`, which reads as a refusal.
    //
    // Measured identically on `main` before #66: this is the insert loop,
    // recorded on #65, not the flag this PR removed. When #65 is fixed,
    // this test must fail and be rewritten to expect three inserts.
    expect(reported.filter((outcome) => outcome.kind === 'inserted')).toHaveLength(1);
    expect(reported.filter((outcome) => outcome.kind === 'cancelled')).toHaveLength(2);
    expect(getAllImages()).toHaveLength(1);
  });

  it('asks once for the gesture when the user cancels, too (#66)', async () => {
    const stop = answerDialogsWith('Cancel');
    const instance = wiredEditor();

    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2), makeImage('c.png', 3)]);
    await vi.waitFor(() => expect(reported).toHaveLength(3));
    stop();

    expect(dialogsSeen).toBe(1);
    expect(reported.every((outcome) => outcome.kind === 'cancelled')).toBe(true);
    expect(getAllImages()).toEqual([]);
  });

  it('asks again on the next gesture after a cancelled one (#66)', async () => {
    const instance = wiredEditor();

    const stopCancelling = answerDialogsWith('Cancel');
    pasteImages(instance, [makeImage('a.png', 1)]);
    await vi.waitFor(() => expect(reported).toHaveLength(1));
    stopCancelling();

    const stopAccepting = answerDialogsWith('Continue');
    pasteImages(instance, [makeImage('b.png', 2)]);
    await vi.waitFor(() => expect(reported).toHaveLength(2));
    stopAccepting();

    expect(dialogsSeen).toBe(2);
    expect(reported[1]).toEqual({ kind: 'inserted' });
    expect(getAllImages()).toHaveLength(1);
  });
});
