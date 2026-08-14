import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { handleImageFile, MAX_IMAGE_SIZE } from './image-handler';

vi.mock('../ui/toast', () => ({
  showToast: vi.fn(),
}));

vi.mock('./image-registry', () => ({
  registerImage: vi.fn(),
}));

vi.mock('../platform/detect', () => ({
  isTauri: false,
}));

function makeStubEditor() {
  const setImage = vi.fn(() => ({ run: vi.fn() }));
  const focus = vi.fn(() => ({ setImage }));
  const chain = vi.fn(() => ({ focus }));
  return { chain } as unknown as Editor;
}

function makeFile(size: number, type = 'image/png', name = 'big.png'): File {
  return {
    size,
    type,
    name,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
  } as unknown as File;
}

describe('handleImageFile — M5 size cap', () => {
  it('bails out before any I/O when file exceeds MAX_IMAGE_SIZE', async () => {
    const editor = makeStubEditor();
    const getFilePath = vi.fn(() => '/doc/notes.md');
    const requestSaveAs = vi.fn(async () => '/doc/notes.md');
    const imagePasteCheck = vi.fn(() => ({ allowed: true }));
    const ensureAssetsDir = vi.fn(async () => '/doc/assets');

    const oversized = makeFile(MAX_IMAGE_SIZE + 1);
    await handleImageFile(
      oversized,
      editor,
      getFilePath,
      requestSaveAs,
      imagePasteCheck,
      ensureAssetsDir,
    );

    expect(ensureAssetsDir).not.toHaveBeenCalled();
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
  });

  it('proceeds past the size guard when file fits under the cap', async () => {
    const editor = makeStubEditor();
    const getFilePath = vi.fn(() => '/doc/notes.md');
    const requestSaveAs = vi.fn(async () => '/doc/notes.md');
    const imagePasteCheck = vi.fn(() => ({ allowed: true }));
    const ensureAssetsDir = vi.fn(async () => '/doc/assets');

    const ok = makeFile(1024);
    await handleImageFile(ok, editor, getFilePath, requestSaveAs, imagePasteCheck, ensureAssetsDir);

    expect(ensureAssetsDir).toHaveBeenCalledTimes(1);
    expect(ok.arrayBuffer).toHaveBeenCalledTimes(1);
  });
});
