import { describe, expect, it, vi } from 'vitest';
import type { PlatformIO } from '../platform/types';
import { showToast } from '../ui/toast';
import type { DocumentActions } from './document-actions';
import { createSidebarClickHandler } from './sidebar-click';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

function makeDocActions(): DocumentActions {
  return {
    handleNew: vi.fn(async () => {}),
    handleNewFromTemplate: vi.fn(async () => {}),
    handleOpen: vi.fn(async () => {}),
    handleSave: vi.fn(async () => {}),
    handleSaveAs: vi.fn(async () => {}),
    handleClose: vi.fn(async () => {}),
    openFilePath: vi.fn(async () => {}),
    openRecentFile: vi.fn(async () => {}),
    requestSaveAs: vi.fn(async () => null),
    confirmWindowClose: vi.fn(async () => true),
  };
}

function makeIO(): PlatformIO {
  return {
    // Desktop-shaped: every path carries a directory (#46).
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    readSnapshot: async () => ({ kind: 'absent' as const }),
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async () => 'absent' as const,
    listDir: async () => [],
    mkdir: async () => {},
    openWithSystem: vi.fn(async () => {}),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createSidebarClickHandler', () => {
  it('routes .md clicks through openFilePath, with the root they came from', async () => {
    const docActions = makeDocActions();
    const io = makeIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/notes/sub/other.md', '/proj/notes');
    await flush();
    // The second argument is the whole of this handler's part in #178:
    // it used to receive `rootPath`, use it for the check above and drop
    // it. `refreshSidebar` decides what is done with it.
    expect(docActions.openFilePath).toHaveBeenCalledWith('/proj/notes/sub/other.md', '/proj/notes');
    expect(io.openWithSystem).not.toHaveBeenCalled();
  });

  it('passes the root a click came from even when the file sits in a subfolder', async () => {
    // The 0.4 case of #178, at this layer: the root travels unchanged, so
    // whatever keeps it keeps the folder the user was browsing rather
    // than the folder the file happens to sit in.
    const docActions = makeDocActions();
    const io = makeIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/notes/sub/deep/chapter.md', '/proj/notes');
    await flush();
    expect(docActions.openFilePath).toHaveBeenCalledWith(
      '/proj/notes/sub/deep/chapter.md',
      '/proj/notes',
    );
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

  // F5 of the #20 readings (#448): the rejection landed in a catch that wrote
  // to the console only, and the toast sat after the await, so a click on a
  // file the shell refused did nothing and said nothing.
  it('says so when the system cannot open the file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const docActions = makeDocActions();
    const io = makeIO();
    vi.mocked(io.openWithSystem).mockRejectedValue(new Error('failed regex validation'));
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle(
      'C:/Users/vasil/Documents/New folder/assets/diagram.png',
      'C:/Users/vasil/Documents/New folder',
    );
    await flush();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('diagram.png'), 'error');
  });
});
