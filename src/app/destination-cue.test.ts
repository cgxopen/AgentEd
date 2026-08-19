import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleImageFile } from '../editor/image-handler';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import { createDestinationCue, DESTINATION_CUE } from './destination-cue';
import { AppState } from './state';

/**
 * Whether the current test runs as the desktop build. A getter rather
 * than a literal so a single test can speak for the web build, where the
 * destination picker never appears (#46).
 */
let onDesktop = true;
vi.mock('../platform/detect', () => ({
  get isTauri() {
    return onDesktop;
  },
}));

vi.mock('../platform/index', () => ({
  getPlatformIO: vi.fn(async () => ({
    listDir: vi.fn(async () => []),
  })),
}));

let instance: EditorInstance;
let state: AppState;

/** What the user can actually read on screen right now. */
function toastTexts(): string[] {
  return Array.from(document.querySelectorAll('#toast-container .toast')).map(
    (el) => el.textContent ?? '',
  );
}

function makeImage(name = 'image.png'): File {
  return {
    size: 1024,
    type: 'image/png',
    name,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as File;
}

/** Insert one image the way paste, drop and Insert Media all do. */
async function insertImage(
  requestSaveAs: () => Promise<string | null>,
  confirmAssetsDir: () => Promise<string | null>,
  name?: string,
): Promise<void> {
  await handleImageFile(
    makeImage(name),
    instance.editor,
    () => state.filePath,
    requestSaveAs,
    confirmAssetsDir,
    'clipboard',
    createDestinationCue(state),
  );
}

/** The picker the desktop build shows when the document has no path yet. */
function pickerReturning(path: string | null): () => Promise<string | null> {
  return async () => {
    if (path) state.filePath = path;
    return path;
  };
}

const assetsAgreed = async () => '/doc/assets';
const assetsDeclined = async () => null;

describe('destination cue on image insert (#48)', () => {
  beforeEach(() => {
    onDesktop = true;
    state = new AppState();
    clearImages();
    for (const toast of document.querySelectorAll('.toast')) toast.remove();
    const host = document.createElement('div');
    document.body.appendChild(host);
    instance = createEditor(host);
  });

  it('explains the silence once the image is in a never-saved document', async () => {
    await insertImage(pickerReturning('/doc/notes.md'), assetsAgreed);

    // The cue only makes sense after the image is visible — assert the
    // editor really holds it, not merely that the flow ran (#33).
    expect(instance.editor.getHTML()).toContain('<img');
    expect(toastTexts()).toEqual([DESTINATION_CUE]);
  });

  it('names the keystroke that puts the document and its images on disk', () => {
    expect(DESTINATION_CUE).toContain('Ctrl+S');
  });

  it('says it once, however many images the document receives', async () => {
    const picker = pickerReturning('/doc/notes.md');
    await insertImage(picker, assetsAgreed, 'one.png');
    await insertImage(picker, assetsAgreed, 'two.png');
    await insertImage(picker, assetsAgreed, 'three.png');

    expect(toastTexts()).toEqual([DESTINATION_CUE]);
  });

  it('says nothing when the destination picker is cancelled', async () => {
    await insertImage(pickerReturning(null), assetsAgreed);

    expect(instance.editor.getHTML()).not.toContain('<img');
    expect(toastTexts()).toEqual([]);
  });

  it('says nothing when the assets/ confirmation is cancelled', async () => {
    await insertImage(pickerReturning('/doc/notes.md'), assetsDeclined);

    expect(instance.editor.getHTML()).not.toContain('<img');
    expect(toastTexts()).toEqual([]);
  });

  it('says nothing for a document already on disk — there is nothing pending', async () => {
    state.filePath = '/doc/notes.md';
    state.isFirstSave = false;

    await insertImage(pickerReturning('/doc/notes.md'), assetsAgreed);

    expect(instance.editor.getHTML()).toContain('<img');
    expect(toastTexts()).toEqual([]);
  });

  it('promises no save on the web build, where the insert never gets that far', async () => {
    // The web build asks for no destination (#46): with no path, the
    // assets/ wiring in main.ts returns null and the insert stops there.
    onDesktop = false;
    const neverAsked = vi.fn(async () => null);
    const webAssetsDir = async () => (state.filePath ? '/doc/assets' : null);

    await insertImage(neverAsked, webAssetsDir);

    expect(neverAsked).not.toHaveBeenCalled();
    expect(instance.editor.getHTML()).not.toContain('<img');
    expect(toastTexts()).toEqual([]);
  });
});
