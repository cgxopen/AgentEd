/**
 * End-to-end integration scenario for the sidebar flow (R-C6).
 * Composes shouldShowSidebar + walkRecursive (via refreshSidebar) + the
 * click handler against a stubbed PlatformIO that simulates a document
 * with an adjacent folder three levels deep:
 *
 *   /proj/
 *   ├── doc.md          ← currently open
 *   └── doc/            ← sidebar root
 *       ├── assets/
 *       │   └── image.png
 *       ├── references/
 *       │   └── notes.md
 *       └── scripts/
 *           └── helper.py
 */
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, PlatformIO } from '../platform/types';
import type { Sidebar, TreeNode } from '../ui/sidebar';
import type { DocumentActions } from './document-actions';
import { createSidebarClickHandler } from './sidebar-click';
import { refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

function buildIO(): PlatformIO {
  const tree: Record<string, FileEntry[]> = {
    '/proj/doc': [
      { name: 'assets', path: '/proj/doc/assets', isDirectory: true },
      { name: 'references', path: '/proj/doc/references', isDirectory: true },
      { name: 'scripts', path: '/proj/doc/scripts', isDirectory: true },
    ],
    '/proj/doc/assets': [
      { name: 'image.png', path: '/proj/doc/assets/image.png', isDirectory: false },
    ],
    '/proj/doc/references': [
      { name: 'notes.md', path: '/proj/doc/references/notes.md', isDirectory: false },
    ],
    '/proj/doc/scripts': [
      { name: 'helper.py', path: '/proj/doc/scripts/helper.py', isDirectory: false },
    ],
  };
  const existing = new Set(['/proj/doc']);
  return {
    supportsMultiFile: true,
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
    exists: async (p: string) => existing.has(p),
    listDir: async (p: string) => tree[p] ?? [],
    mkdir: async () => {},
    remove: async () => {},
    openWithSystem: vi.fn(async () => {}),
  };
}

function captureSidebar(): { sidebar: Sidebar; lastShow: () => SidebarShowCall | null } {
  let lastShow: SidebarShowCall | null = null;
  const sidebar: Sidebar = {
    showTree: (nodes, rootName, rootPath) => {
      lastShow = { nodes, rootName, rootPath };
    },
    hide: () => {
      lastShow = null;
    },
    isVisible: () => lastShow !== null,
    toggle: () => {},
    setOnFileClick: () => {},
  };
  return { sidebar, lastShow: () => lastShow };
}

interface SidebarShowCall {
  nodes: TreeNode[];
  rootName: string;
  rootPath: string;
}

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
    confirmWindowClose: vi.fn(async () => true),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Sidebar integration — adjacent folder, 3 levels', () => {
  it('lists assets/, references/, scripts/ under the sibling root', async () => {
    const state = new AppState();
    state.filePath = '/proj/doc.md';
    const io = buildIO();
    const { sidebar, lastShow } = captureSidebar();

    await refreshSidebar(state, sidebar, io);

    const call = lastShow();
    expect(call).not.toBeNull();
    expect(call!.rootPath).toBe('/proj/doc');

    const topLevel = call!.nodes.map((n) => n.name).sort();
    expect(topLevel).toEqual(['assets', 'references', 'scripts']);

    const assetsNode = call!.nodes.find((n) => n.name === 'assets');
    expect(assetsNode?.children.map((c) => c.name)).toEqual(['image.png']);

    const referencesNode = call!.nodes.find((n) => n.name === 'references');
    expect(referencesNode?.children.map((c) => c.name)).toEqual(['notes.md']);

    const scriptsNode = call!.nodes.find((n) => n.name === 'scripts');
    expect(scriptsNode?.children.map((c) => c.name)).toEqual(['helper.py']);
  });

  it('routes notes.md (nested .md) through openFilePath without touching state', async () => {
    const docActions = makeDocActions();
    const io = buildIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/doc/references/notes.md', '/proj/doc');
    await flush();
    expect(docActions.openFilePath).toHaveBeenCalledWith('/proj/doc/references/notes.md');
    expect(io.openWithSystem).not.toHaveBeenCalled();
  });

  it('routes helper.py through openWithSystem', async () => {
    const docActions = makeDocActions();
    const io = buildIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/doc/scripts/helper.py', '/proj/doc');
    await flush();
    expect(io.openWithSystem).toHaveBeenCalledWith('/proj/doc/scripts/helper.py');
    expect(docActions.openFilePath).not.toHaveBeenCalled();
  });

  it('routes image.png through openWithSystem', async () => {
    const docActions = makeDocActions();
    const io = buildIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/doc/assets/image.png', '/proj/doc');
    await flush();
    expect(io.openWithSystem).toHaveBeenCalledWith('/proj/doc/assets/image.png');
  });

  it('refuses a crafted ".." that would escape the listing root', async () => {
    const docActions = makeDocActions();
    const io = buildIO();
    const handle = createSidebarClickHandler(docActions, async () => io);
    handle('/proj/doc/../doc.md', '/proj/doc');
    await flush();
    expect(docActions.openFilePath).not.toHaveBeenCalled();
    expect(io.openWithSystem).not.toHaveBeenCalled();
  });
});
