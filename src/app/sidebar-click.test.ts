import { describe, expect, it, vi } from 'vitest';
import type { PlatformIO } from '../platform/types';
import type { DocumentActions } from './document-actions';
import { createSidebarClickHandler } from './sidebar-click';

function makeDocActions(): DocumentActions {
  return {
    handleNew: vi.fn(async () => {}),
    handleNewFromTemplate: vi.fn(async () => {}),
    handleOpen: vi.fn(async () => {}),
    handleSave: vi.fn(async () => {}),
    handleSaveAs: vi.fn(async () => {}),
    handleClose: vi.fn(async () => {}),
    openFilePath: vi.fn(async () => {}),
    requestSaveAs: vi.fn(async () => null),
  };
}

function makeIO(): PlatformIO {
  return {
    supportsMultiFile: true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    saveFileAs: async () => null,
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    exists: async () => false,
    listDir: async () => [],
    mkdir: async () => {},
    remove: async () => {},
    openWithSystem: vi.fn(async () => {}),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createSidebarClickHandler', () => {
  it('routes .md clicks through openFilePath', async () => {
    const docActions = makeDocActions();
    const io = makeIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/notes/sub/other.md', '/proj/notes');
    await flush();
    expect(docActions.openFilePath).toHaveBeenCalledWith('/proj/notes/sub/other.md');
    expect(io.openWithSystem).not.toHaveBeenCalled();
  });

  it('routes non-.md clicks through openWithSystem', async () => {
    const docActions = makeDocActions();
    const io = makeIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/notes/assets/img.png', '/proj/notes');
    await flush();
    expect(io.openWithSystem).toHaveBeenCalledWith('/proj/notes/assets/img.png');
    expect(docActions.openFilePath).not.toHaveBeenCalled();
  });

  it('rejects clicks whose target traverses outside root via "..".', async () => {
    const docActions = makeDocActions();
    const io = makeIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/notes/../etc/passwd', '/proj/notes');
    await flush();
    expect(io.openWithSystem).not.toHaveBeenCalled();
    expect(docActions.openFilePath).not.toHaveBeenCalled();
  });

  it('rejects sibling-prefix paths that look inside root but are not', async () => {
    const docActions = makeDocActions();
    const io = makeIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/notes-other/leaked.md', '/proj/notes');
    await flush();
    expect(io.openWithSystem).not.toHaveBeenCalled();
    expect(docActions.openFilePath).not.toHaveBeenCalled();
  });
});
