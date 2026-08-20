/**
 * Issue #61 — an image insert has five ways to end and only one of them
 * used to report anything.
 *
 * The flow is wired here exactly as `main.ts` wires it — the real
 * `handleImageFile`, the real `confirmAssetsDir`, the real reporter,
 * behind a `PlatformIO` that records every call (the #45/#50 precedent) —
 * so each test drives an exit rather than asserting on an intermediate
 * function. Two of the five say nothing to the user, and those are the
 * ones worth having: the assertion is that the insert reported a
 * *cancellation*, not merely that the screen stayed empty. Silence and an
 * unreported failure look identical from the outside, which is exactly
 * how #51 and #46 came to share a door.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleImageFile, MAX_IMAGE_SIZE } from '../editor/image-handler';
import type { ImageInsertOutcome } from '../editor/image-insert-outcome';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { confirmAssetsDir } from './assets-dir';
import { DESTINATION_CUE } from './destination-cue';
import {
  createImageInsertReporter,
  imageTooLargeMessage,
  NO_FREE_IMAGE_NAME,
} from './image-insert-report';
import { insertMedia } from './media-picker';
import { AppState } from './state';

/** What the fake assets folder holds. */
let filesOnDisk: string[] = [];
/** Every filesystem call the flow made, in order. */
let calls: string[] = [];
/** The path the native picker returns to Insert Media, if it is used. */
let pickedFile: string | null = null;

const io: PlatformIO = {
  supportsMultiFile: true,
  openFile: async () => null,
  pickFile: async () => pickedFile,
  readText: async () => '',
  saveFile: async (path: string) => {
    calls.push(`saveFile ${path}`);
  },
  pickSavePath: async () => null,
  readSnapshot: async () => ({ kind: 'absent' as const }),
  installCloseGuard: async () => {},
  // Distinct from anything the tests insert, so a name collision stays a
  // collision and is never mistaken for the same picture again (#52).
  readBinary: async (path: string) => {
    calls.push(`readBinary ${path}`);
    return Uint8Array.from([255, 254, 253, 252]);
  },
  writeBinary: async (path: string) => {
    calls.push(`writeBinary ${path}`);
  },
  exists: async () => false,
  listDir: async (path: string): Promise<FileEntry[]> => {
    calls.push(`listDir ${path}`);
    return filesOnDisk.map((name) => ({ name, path: `${path}/${name}`, isDirectory: false }));
  },
  mkdir: async (path: string) => {
    calls.push(`mkdir ${path}`);
  },
  remove: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/detect', () => ({ isTauri: true }));
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/confirm-dialog', () => ({ showConfirmDialog: vi.fn() }));

let instance: EditorInstance;
let state: AppState;
/** Every outcome the insert reported, in order. */
let reported: ImageInsertOutcome[];
/** The app-layer reporter under test, with the outcomes recorded on the way in. */
let report: (outcome: ImageInsertOutcome) => void;

/** What the user can actually read on screen right now. */
function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('#toast-container .toast')).map(
    (el) => el.textContent ?? '',
  );
}

function makeImage(name = 'image.png', size = 1024, seed = 1): File {
  const data = Uint8Array.from({ length: 8 }, (_, i) => (seed * 31 + i) % 251);
  return {
    size,
    type: 'image/png',
    name,
    arrayBuffer: async () => data.slice().buffer,
  } as unknown as File;
}

/** The destination picker the desktop build shows for a document with no path. */
function pickerReturning(path: string | null): () => Promise<string | null> {
  return async () => {
    if (path) state.filePath = path;
    return path;
  };
}

/** The assets/ question, wired to the real consent as `main.ts` wires it. */
async function askForAssetsDir(): Promise<string | null> {
  const path = state.filePath;
  if (!path) return null;
  return confirmAssetsDir(path, io, state);
}

/** Insert one image the way paste and drop do. */
async function insertImage(
  requestSaveAs: () => Promise<string | null>,
  file: File = makeImage(),
): Promise<void> {
  await handleImageFile(
    file,
    instance.editor,
    () => state.filePath,
    requestSaveAs,
    askForAssetsDir,
    'file',
    report,
  );
}

beforeEach(() => {
  filesOnDisk = [];
  calls = [];
  pickedFile = null;
  reported = [];
  state = new AppState();
  clearImages();
  vi.mocked(showConfirmDialog).mockReset();
  vi.mocked(showConfirmDialog).mockResolvedValue('create');
  for (const toast of document.querySelectorAll('.toast')) toast.remove();
  const appReporter = createImageInsertReporter(state);
  report = (outcome) => {
    reported.push(outcome);
    appReporter(outcome);
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
});

describe('#61 — the two exits that stay silent', () => {
  it('reports a cancellation when the destination picker is cancelled', async () => {
    await insertImage(pickerReturning(null));

    expect(reported).toEqual([{ kind: 'cancelled', at: 'destination' }]);
    expect(toastTexts()).toEqual([]);
    expect(instance.editor.getHTML()).not.toContain('<img');
  });

  it('reports a cancellation when the assets/ folder is declined', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');

    await insertImage(pickerReturning('/doc/notes.md'));

    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([{ kind: 'cancelled', at: 'assets-folder' }]);
    expect(toastTexts()).toEqual([]);
    expect(instance.editor.getHTML()).not.toContain('<img');
  });

  it('asks again after a refusal, and reports each cancellation (#66)', async () => {
    // This test is #63's, with its expectation inverted on purpose: it
    // used to assert one dialog across two inserts, because a refusal was
    // remembered. #66 removed that — cancel means "not this image".
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');
    const picker = pickerReturning('/doc/notes.md');

    await insertImage(picker, makeImage('one.png', 1024, 1));
    await insertImage(picker, makeImage('two.png', 1024, 2));

    expect(showConfirmDialog).toHaveBeenCalledTimes(2);
    expect(reported).toEqual([
      { kind: 'cancelled', at: 'assets-folder' },
      { kind: 'cancelled', at: 'assets-folder' },
    ]);
    expect(toastTexts()).toEqual([]);
  });

  it('inserts normally once the folder is agreed to after a refusal (#66)', async () => {
    const picker = pickerReturning('/doc/notes.md');
    vi.mocked(showConfirmDialog).mockResolvedValueOnce('cancel');

    await insertImage(picker, makeImage('one.png', 1024, 1));
    expect(instance.editor.getHTML()).not.toContain('<img');

    vi.mocked(showConfirmDialog).mockResolvedValue('create');
    await insertImage(picker, makeImage('two.png', 1024, 2));
    await insertImage(picker, makeImage('three.png', 1024, 3));

    // Asked twice, not three times: the agreement is still remembered,
    // only the refusal is not (R-C5).
    expect(showConfirmDialog).toHaveBeenCalledTimes(2);
    expect(reported).toEqual([
      { kind: 'cancelled', at: 'assets-folder' },
      { kind: 'inserted' },
      { kind: 'inserted' },
    ]);
    // One cue for the document, raised by the first image that landed.
    expect(toastTexts()).toEqual([DESTINATION_CUE]);
  });
});

describe('#61 — the two exits that speak', () => {
  it('reports a refusal, and says why, for an image over the size cap', async () => {
    const oversized = makeImage('huge.png', MAX_IMAGE_SIZE + 1);

    await insertImage(pickerReturning('/doc/notes.md'), oversized);

    expect(reported).toEqual([
      {
        kind: 'refused',
        reason: 'too-large',
        sizeBytes: oversized.size,
        limitBytes: MAX_IMAGE_SIZE,
      },
    ]);
    expect(toastTexts()).toEqual([imageTooLargeMessage(oversized.size, MAX_IMAGE_SIZE)]);
    // Refused before anything is read or asked: no picker, no folder.
    expect(calls).toEqual([]);
  });

  it('reports a refusal, and says why, when no free name is left in assets/', async () => {
    // `diagram.png` plus every numeric variant the naming rule will try.
    filesOnDisk = [
      'diagram.png',
      ...Array.from({ length: 1001 }, (_, i) => `diagram-${i + 2}.png`),
    ];
    state.filePath = '/doc/notes.md';
    state.isFirstSave = false;

    await insertImage(pickerReturning('/doc/notes.md'), makeImage('diagram.png'));

    expect(reported).toEqual([{ kind: 'refused', reason: 'no-free-name' }]);
    expect(toastTexts()).toEqual([NO_FREE_IMAGE_NAME]);
    expect(instance.editor.getHTML()).not.toContain('<img');
  });

  it('says exactly what it said before this refactor', () => {
    // The two messages moved out of src/editor unchanged. Pinned here so
    // a wording change becomes a deliberate edit to a test rather than a
    // silent one (#50 precedent).
    expect(imageTooLargeMessage(26 * 1024 * 1024, MAX_IMAGE_SIZE)).toBe(
      'Image too large (26 MB). Max 25 MB.',
    );
    expect(NO_FREE_IMAGE_NAME).toBe('Could not find a free file name in the assets folder.');
  });
});

describe('#61 — the exit that succeeds', () => {
  it('reports the insert once the image is in the document', async () => {
    await insertImage(pickerReturning('/doc/notes.md'));

    expect(reported).toEqual([{ kind: 'inserted' }]);
    expect(instance.editor.getHTML()).toContain('<img');
    expect(toastTexts()).toEqual([DESTINATION_CUE]);
  });

  it('still cues a never-saved document once, however many images land', async () => {
    const picker = pickerReturning('/doc/notes.md');

    await insertImage(picker, makeImage('one.png', 1024, 1));
    await insertImage(picker, makeImage('two.png', 1024, 2));
    await insertImage(picker, makeImage('three.png', 1024, 3));

    expect(reported).toEqual([{ kind: 'inserted' }, { kind: 'inserted' }, { kind: 'inserted' }]);
    expect(toastTexts()).toEqual([DESTINATION_CUE]);
  });

  it('says nothing for a document already on disk — there is nothing pending', async () => {
    state.filePath = '/doc/notes.md';
    state.isFirstSave = false;

    await insertImage(pickerReturning('/doc/notes.md'));

    expect(reported).toEqual([{ kind: 'inserted' }]);
    expect(toastTexts()).toEqual([]);
  });
});

describe('#61 — the drop and paste plugins', () => {
  /**
   * An editor wired for images the way `main.ts` wires it, so the drop
   * and paste handlers under test are the registered plugin rather than
   * a direct call to `handleImageFile`.
   */
  function wiredEditor(): EditorInstance {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return createEditor(host, undefined, {
      getFilePath: () => state.filePath,
      requestSaveAs: pickerReturning('/doc/notes.md'),
      confirmAssetsDir: askForAssetsDir,
      report,
    });
  }

  /** Fire a drop or paste carrying the given files, as the browser would. */
  function drop(wired: EditorInstance, prop: 'handleDrop' | 'handlePaste', files: File[]): boolean {
    const transfer = { files, types: ['Files'], getData: () => '' };
    const event = {
      dataTransfer: transfer,
      clipboardData: transfer,
      preventDefault: () => undefined,
    } as unknown as DragEvent & ClipboardEvent;
    const { view } = wired.editor;
    return Boolean(
      view.someProp(prop, (handler) => handler(view, event, view.state.selection.content(), false)),
    );
  }

  it('registers the drop handler and reports through it', async () => {
    const wired = wiredEditor();

    expect(drop(wired, 'handleDrop', [makeImage()])).toBe(true);

    await vi.waitFor(() => expect(reported).toEqual([{ kind: 'inserted' }]));
  });

  it('registers the paste handler and reports through it', async () => {
    const wired = wiredEditor();

    expect(drop(wired, 'handlePaste', [makeImage()])).toBe(true);

    await vi.waitFor(() => expect(reported).toEqual([{ kind: 'inserted' }]));
  });

  it('reports every file of a multi-file drop, one by one', async () => {
    const wired = wiredEditor();
    const huge = () => makeImage('huge.png', MAX_IMAGE_SIZE + 1);

    drop(wired, 'handleDrop', [huge(), huge(), huge()]);

    // Three refusals and three messages — what the build did before #61,
    // and the decision recorded in `createImageDropPlugin`.
    await vi.waitFor(() => expect(reported).toHaveLength(3));
    expect(reported.every((outcome) => outcome.kind === 'refused')).toBe(true);
    expect(toastTexts()).toHaveLength(3);
  });
});

describe('#61 — the third entry point', () => {
  /** Insert Media, wired as `main.ts` wires it. */
  async function pickAndInsert(): Promise<void> {
    await insertMedia({
      state,
      editor: instance.editor,
      requestSaveAs: pickerReturning('/doc/notes.md'),
      reporter: { silent: vi.fn(), toast: vi.fn(), dialog: vi.fn(async () => {}) },
      report,
    });
  }

  it('reports an Insert Media through the same channel as paste and drop', async () => {
    pickedFile = '/pictures/diagram.png';

    await pickAndInsert();

    expect(reported).toEqual([{ kind: 'inserted' }]);
    expect(toastTexts()).toEqual([DESTINATION_CUE]);
  });

  it('reports a declined folder from Insert Media as the same cancellation', async () => {
    pickedFile = '/pictures/diagram.png';
    vi.mocked(showConfirmDialog).mockResolvedValue('cancel');

    await pickAndInsert();

    expect(reported).toEqual([{ kind: 'cancelled', at: 'assets-folder' }]);
    expect(toastTexts()).toEqual([]);
  });
});
