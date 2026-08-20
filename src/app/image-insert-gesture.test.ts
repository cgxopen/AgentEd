/**
 * One gesture, several images (#68).
 *
 * Rewritten from the file #67 left behind, which pinned the defect: a
 * paste carrying three images inserted one and reported two
 * cancellations. Those expectations failing is what says this is fixed,
 * so they are replaced rather than adapted.
 *
 * Separate from `image-insert-report.test.ts` because it must use the
 * **real** `showConfirmDialog`: the question here is what several inserts
 * do around one consent, and a mocked dialog has none of the behaviour
 * that decides the answer — including the concurrency guard whose `null`
 * caused the defect. Dialogs are answered by clicking the button a user
 * would click.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertImageGesture, MAX_GESTURE_BYTES, MAX_IMAGE_SIZE } from '../editor/image-handler';
import type { ImageInsertOutcome } from '../editor/image-insert-outcome';
import { clearImages, getAllImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, PlatformIO } from '../platform/types';
import { confirmAssetsDir } from './assets-dir';
import { DESTINATION_CUE } from './destination-cue';
import {
  createImageInsertReporter,
  imageGestureTooLargeMessage,
  imageTooLargeMessage,
} from './image-insert-report';
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
/** How many times the whole gesture opened the destination picker. */
let saveAsCalls: number;
/** Anything `showConfirmDialog` refused because another dialog was open. */
let concurrencyWarnings: string[];

function makeImage(name: string, seed: number): File {
  const data = Uint8Array.from({ length: 8 }, (_, i) => (seed * 31 + i) % 251);
  return {
    size: data.length,
    type: 'image/png',
    name,
    arrayBuffer: async () => data.slice().buffer,
  } as unknown as File;
}

/** An image the size cap refuses, so a gesture can carry a mix. */
function makeOversizedImage(name: string): File {
  return { ...makeImage(name, 9), size: MAX_IMAGE_SIZE + 1 } as unknown as File;
}

const MB = 1024 * 1024;

/**
 * An image that *claims* a size without carrying the bytes.
 *
 * The budget is decided from `file.size` before anything is read (#71),
 * which is exactly what lets a test drive a 200 MB gesture through the
 * real path in milliseconds and without the memory the feature exists to
 * refuse. The bytes stay distinct per seed so nothing deduplicates (#52).
 */
function makeSizedImage(name: string, seed: number, sizeBytes: number): File {
  return { ...makeImage(name, seed), size: sizeBytes } as unknown as File;
}

/** `count` images of `sizeMb` each, named and seeded apart. */
function sizedGesture(count: number, sizeMb: number): File[] {
  return Array.from({ length: count }, (_, i) =>
    makeSizedImage(`img-${i}.png`, i + 10, sizeMb * MB),
  );
}

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('#toast-container .toast')).map(
    (el) => el.textContent ?? '',
  );
}

function imagePaths(): string[] {
  return getAllImages().map((image) => image.relativePath);
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
function wiredEditor(report: (outcome: ImageInsertOutcome) => void): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return createEditor(host, undefined, {
    getFilePath: () => state.filePath,
    requestSaveAs: async () => {
      saveAsCalls++;
      state.filePath = '/doc/notes.md';
      return state.filePath;
    },
    confirmAssetsDir: async () => {
      const path = state.filePath;
      if (!path) return null;
      return confirmAssetsDir(path, io, state);
    },
    report,
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

/**
 * Let everything the paste started run to the end. The insert path is
 * await-driven with no timers of its own, so a few macrotask turns are
 * past the point where anything more could arrive — which is what makes
 * "and no second dialog appeared" an assertion rather than a hope.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  state = new AppState();
  state.filePath = '/doc/notes.md';
  state.isFirstSave = false;
  reported = [];
  dialogsSeen = 0;
  saveAsCalls = 0;
  concurrencyWarnings = [];
  clearImages();
  // Close a dialog a failing test may have left open through its own
  // buttons rather than by removing the node: `showConfirmDialog` keeps
  // the open one in module state, and a detached overlay would refuse
  // every dialog in every test after it.
  for (let i = 0; i < 4; i++) {
    const overlay = document.querySelector('.dialog-overlay');
    if (!overlay) break;
    overlay.querySelector('button')?.click();
    overlay.remove();
  }
  for (const el of document.querySelectorAll('.toast')) el.remove();
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (text.includes('another dialog is already open')) concurrencyWarnings.push(text);
  });
});

describe('one paste carrying three images', () => {
  const record = (outcome: ImageInsertOutcome): void => {
    reported.push(outcome);
  };

  it('asks once and inserts all three (#68)', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(record);

    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2), makeImage('c.png', 3)]);
    await vi.waitFor(() => expect(reported).toHaveLength(3));
    await settle();
    stop();

    expect(dialogsSeen).toBe(1);
    expect(reported.filter((outcome) => outcome.kind === 'inserted')).toHaveLength(3);
    // Sequenced, so the order is the gesture's rather than whichever
    // insert happened to finish first.
    expect(imagePaths()).toEqual(['assets/a.png', 'assets/b.png', 'assets/c.png']);
  });

  it('never meets the concurrent-dialog guard, whose null was the defect (#68)', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(record);

    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2), makeImage('c.png', 3)]);
    await vi.waitFor(() => expect(reported).toHaveLength(3));
    await settle();
    stop();

    // The guard is still there and still right; sequencing means nothing
    // on the insert path reaches it, so no insert is ever refused by it
    // and reported as a cancellation the user did not make.
    expect(concurrencyWarnings).toEqual([]);
  });

  it('cancelling inserts nothing, says nothing, and does not ask again for the rest', async () => {
    const stop = answerDialogsWith('Cancel');
    const instance = wiredEditor(record);

    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2), makeImage('c.png', 3)]);
    await vi.waitFor(() => expect(reported).toHaveLength(1));
    await settle();
    stop();

    expect(dialogsSeen).toBe(1);
    // One outcome, for the file the question was asked about. The two
    // behind it are never attempted, so they have no exit to report —
    // which is the same silence, arrived at honestly.
    expect(reported).toEqual([{ kind: 'cancelled', at: 'assets-folder' }]);
    expect(getAllImages()).toEqual([]);
    expect(toastTexts()).toEqual([]);
  });

  it('asks again on the next gesture after a cancelled one (R-C5, #66)', async () => {
    const instance = wiredEditor(record);

    const stopCancelling = answerDialogsWith('Cancel');
    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2)]);
    await vi.waitFor(() => expect(reported).toHaveLength(1));
    await settle();
    stopCancelling();

    const stopAccepting = answerDialogsWith('Continue');
    pasteImages(instance, [makeImage('c.png', 3), makeImage('d.png', 4)]);
    await vi.waitFor(() => expect(reported).toHaveLength(3));
    await settle();
    stopAccepting();

    expect(dialogsSeen).toBe(2);
    expect(imagePaths()).toEqual(['assets/c.png', 'assets/d.png']);
  });

  it('lands the images a mixed gesture can carry and refuses only the one it cannot', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(createImageInsertReporter(state));

    pasteImages(instance, [
      makeImage('a.png', 1),
      makeOversizedImage('huge.png'),
      makeImage('c.png', 3),
    ]);
    await vi.waitFor(() => expect(imagePaths()).toHaveLength(2));
    await settle();
    stop();

    expect(dialogsSeen).toBe(1);
    expect(imagePaths()).toEqual(['assets/a.png', 'assets/c.png']);
    // An application refusal stops its own file and nothing else, so the
    // gesture continues past it and says so once.
    expect(toastTexts()).toEqual([imageTooLargeMessage(MAX_IMAGE_SIZE + 1, MAX_IMAGE_SIZE)]);
  });
});

describe('a gesture in a document that has never been saved', () => {
  beforeEach(() => {
    state.filePath = null;
    state.isFirstSave = true;
  });

  it('opens the destination picker once for the gesture, not once per image', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(createImageInsertReporter(state));

    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2), makeImage('c.png', 3)]);
    await vi.waitFor(() => expect(imagePaths()).toHaveLength(3));
    await settle();
    stop();

    // The question #68 left open, answered by the shape rather than by a
    // measurement: the first insert sets the path and the rest find it
    // set, so there is nothing concurrent left to measure.
    expect(saveAsCalls).toBe(1);
    expect(dialogsSeen).toBe(1);
  });

  it('shows the destination cue once for three images (#48)', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(createImageInsertReporter(state));

    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2), makeImage('c.png', 3)]);
    await vi.waitFor(() => expect(imagePaths()).toHaveLength(3));
    await settle();
    stop();

    expect(toastTexts()).toEqual([DESTINATION_CUE]);
  });

  it('never opens the destination picker again once the user closed it', async () => {
    // Closing the picker is a cancellation the user made, so the gesture
    // ends there: the two images behind the first are never asked, which
    // is what keeps three files from becoming three native modals.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const instance = createEditor(host, undefined, {
      getFilePath: () => state.filePath,
      requestSaveAs: async () => {
        saveAsCalls++;
        return null;
      },
      confirmAssetsDir: async () => {
        const path = state.filePath;
        if (!path) return null;
        return confirmAssetsDir(path, io, state);
      },
      report: (outcome) => reported.push(outcome),
    });

    pasteImages(instance, [makeImage('a.png', 1), makeImage('b.png', 2), makeImage('c.png', 3)]);
    await vi.waitFor(() => expect(reported).toHaveLength(1));
    await settle();

    expect(saveAsCalls).toBe(1);
    expect(reported).toEqual([{ kind: 'cancelled', at: 'destination' }]);
    expect(getAllImages()).toEqual([]);
  });
});

describe('one image at a time, unchanged', () => {
  it('asks once, inserts it, and reports one outcome', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor((outcome) => reported.push(outcome));

    pasteImages(instance, [makeImage('a.png', 1)]);
    await vi.waitFor(() => expect(reported).toHaveLength(1));
    await settle();
    stop();

    expect(dialogsSeen).toBe(1);
    expect(reported).toEqual([{ kind: 'inserted' }]);
    expect(imagePaths()).toEqual(['assets/a.png']);
  });
});

describe('the gesture loop itself', () => {
  it('stops at a cancellation and continues past a refusal', async () => {
    const stop = answerDialogsWith('Continue');
    const editor = wiredEditor(() => undefined).editor;
    const outcomes: ImageInsertOutcome[] = [];

    // Driven directly so the assertion is on the loop's rule rather than
    // on one path that happens to exercise it: a refusal in the middle
    // must not end the gesture, a cancellation at the end must.
    await insertImageGesture(
      [makeOversizedImage('huge.png'), makeImage('a.png', 1)],
      editor,
      () => state.filePath,
      async () => state.filePath,
      async () => (state.filePath ? confirmAssetsDir(state.filePath, io, state) : null),
      'clipboard',
      (outcome) => outcomes.push(outcome),
    );
    stop();

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['refused', 'inserted']);

    const afterCancel: ImageInsertOutcome[] = [];
    await insertImageGesture(
      [makeImage('b.png', 2), makeImage('c.png', 3)],
      editor,
      () => state.filePath,
      async () => null,
      async () => null,
      'clipboard',
      (outcome) => afterCancel.push(outcome),
    );

    expect(afterCancel).toEqual([{ kind: 'cancelled', at: 'assets-folder' }]);
  });
});

/**
 * The gesture budget (#71) — the bound #70 made necessary by removing
 * the concurrency defect that had been truncating large gestures by
 * accident.
 *
 * Driven through the real paste path with the real `showConfirmDialog`,
 * per the #67/#70 precedent, and through files that declare a size
 * without carrying it, per `makeSizedImage`.
 */
describe('the bytes one gesture may insert', () => {
  /** Records the outcomes and still lets the app layer say its piece. */
  function watchedReporter(): (outcome: ImageInsertOutcome) => void {
    const speak = createImageInsertReporter(state);
    return (outcome) => {
      reported.push(outcome);
      speak(outcome);
    };
  }

  function insertedCount(): number {
    return reported.filter((outcome) => outcome.kind === 'inserted').length;
  }

  it('inserts everything and says nothing about limits when the gesture fits', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(watchedReporter());

    // 6 x 20 MB = 120 MB, comfortably inside the budget.
    pasteImages(instance, sizedGesture(6, 20));
    await vi.waitFor(() => expect(insertedCount()).toBe(6));
    await settle();
    stop();

    expect(dialogsSeen).toBe(1);
    expect(reported.every((outcome) => outcome.kind === 'inserted')).toBe(true);
    expect(toastTexts()).toEqual([]);
  });

  it('inserts a gesture that lands exactly on the budget', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(watchedReporter());

    // 8 x 16 MB = 128 MB, to the byte. The bound is "more than", so this
    // fits — the boundary is a decision, not an accident of `>=`.
    const files = sizedGesture(8, 16);
    expect(files.reduce((total, file) => total + file.size, 0)).toBe(MAX_GESTURE_BYTES);

    pasteImages(instance, files);
    await vi.waitFor(() => expect(insertedCount()).toBe(8));
    await settle();
    stop();

    expect(toastTexts()).toEqual([]);
  });

  it('inserts what fits, refuses the rest, and names both counts', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(watchedReporter());

    // 7 x 20 MB = 140 MB. Six fit (120 MB); the seventh would be 140.
    pasteImages(instance, sizedGesture(7, 20));
    await vi.waitFor(() => expect(toastTexts()).toHaveLength(1));
    await settle();
    stop();

    expect(insertedCount()).toBe(6);
    expect(imagePaths()).toEqual([
      'assets/img-0.png',
      'assets/img-1.png',
      'assets/img-2.png',
      'assets/img-3.png',
      'assets/img-4.png',
      'assets/img-5.png',
    ]);
    expect(reported.at(-1)).toEqual({
      kind: 'refused',
      reason: 'gesture-too-large',
      bytesAttempted: 140 * MB,
      budgetBytes: MAX_GESTURE_BYTES,
      inserted: 6,
      refused: 1,
    });
    // Read as the user reads it, once, literally — the counts and the
    // limit are the whole reason a partial insert is acceptable.
    expect(toastTexts()).toEqual(['Inserted 6 images, 1 left out. Max 128 MB of images at once.']);
  });

  it('stops at the first file that does not fit, leaving the rest of the gesture out', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(watchedReporter());

    // 10 x 20 MB = 200 MB. The file that trips the budget is the
    // seventh, with three more behind it: everything before it lands,
    // nothing after it does, and there is one message for all four.
    pasteImages(instance, sizedGesture(10, 20));
    await vi.waitFor(() => expect(toastTexts()).toHaveLength(1));
    await settle();
    stop();

    expect(insertedCount()).toBe(6);
    expect(imagePaths()).toEqual(sizedGesture(6, 20).map((file) => `assets/${file.name}`));
    expect(toastTexts()).toEqual([imageGestureTooLargeMessage(6, 4, MAX_GESTURE_BYTES)]);
    expect(dialogsSeen).toBe(1);
  });

  it('does not charge the budget for a file that refuses itself for its own size', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(watchedReporter());

    // 6 x 20 MB = 120 MB, plus one oversized file in the middle. Charged
    // for its 26 MB the gesture would be 146 MB and truncate; it never
    // reaches memory, so it costs nothing and truncates nothing.
    const files = sizedGesture(6, 20);
    files.splice(3, 0, makeOversizedImage('huge.png'));

    pasteImages(instance, files);
    await vi.waitFor(() => expect(insertedCount()).toBe(6));
    await settle();
    stop();

    // Its own message, unchanged, and no budget message at all.
    expect(toastTexts()).toEqual([imageTooLargeMessage(MAX_IMAGE_SIZE + 1, MAX_IMAGE_SIZE)]);
    expect(reported.filter((outcome) => outcome.kind === 'refused')).toEqual([
      {
        kind: 'refused',
        reason: 'too-large',
        sizeBytes: MAX_IMAGE_SIZE + 1,
        limitBytes: MAX_IMAGE_SIZE,
      },
    ]);
  });

  it('says nothing about the budget when the user cancelled the gesture', async () => {
    const stop = answerDialogsWith('Cancel');
    const instance = wiredEditor(watchedReporter());

    pasteImages(instance, sizedGesture(10, 20));
    await vi.waitFor(() => expect(reported).toHaveLength(1));
    await settle();
    stop();

    // The user stopped it themselves and hears nothing (#61). A
    // truncation message here would explain something that never
    // happened — nothing was truncated, nothing was inserted.
    expect(reported).toEqual([{ kind: 'cancelled', at: 'assets-folder' }]);
    expect(toastTexts()).toEqual([]);
    expect(getAllImages()).toEqual([]);
  });

  it('counts what actually landed, not what the budget predicted', async () => {
    const stop = answerDialogsWith('Continue');
    const instance = wiredEditor(watchedReporter());

    // The accepted prefix carries an oversized file, so six are admitted
    // by the budget and only five can land. The message must say five.
    const files = sizedGesture(7, 20);
    files.splice(2, 0, makeOversizedImage('huge.png'));

    pasteImages(instance, files);
    await vi.waitFor(() => expect(toastTexts()).toHaveLength(2));
    await settle();
    stop();

    expect(insertedCount()).toBe(6);
    expect(toastTexts()).toContain(imageGestureTooLargeMessage(6, 1, MAX_GESTURE_BYTES));
  });
});
