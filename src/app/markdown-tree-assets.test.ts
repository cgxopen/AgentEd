import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, MarkdownTree, PlatformIO } from '../platform/types';
import { BOUND_LINE_CLASS, type Sidebar, setupSidebar, type TreeRoot } from '../ui/sidebar';
import { UNUSED_CLASS } from '../ui/sidebar-tree';
import { unusedAssetFiles } from './assets-summary';
import { followRelativeLink } from './relative-link';
import { openSidebarByHand, refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

/**
 * The `assets` folders in the markdown tree, the grey of use, and the tree kept
 * on a click or a link (#748, owner decisions of 2026-11-17).
 *
 * What the native walk returns from an `assets` folder is tested in
 * `src-tauri/src/markdown_tree.rs`. Here the answer is given, and the panel,
 * the routes and the grey are the real ones.
 */

const ROOT = '/notes';
const DOC = '/notes/plan.md';
const SUB = '/notes/chapters/one.md';

/** A markdown tree holding two documents, each with an `assets` folder beside it. */
const FILES = [
  'plan.md',
  'assets/used.png',
  'assets/spare.png',
  'chapters/one.md',
  'chapters/assets/scan.jpg',
];

interface Calls {
  markdownTree: Array<{ document: string; root: string }>;
  listDir: string[];
}

function desktopIO(
  answer: MarkdownTree,
  options: { existing?: string[]; entries?: Record<string, FileEntry[]> } = {},
): { io: PlatformIO; calls: Calls } {
  const calls: Calls = { markdownTree: [], listDir: [] };
  const existing = new Set(options.existing ?? []);
  const io: PlatformIO = {
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
    entryPresence: async (p: string) => (existing.has(p) ? 'present' : 'absent'),
    listDir: async (p: string) => {
      calls.listDir.push(p);
      return options.entries?.[p] ?? [];
    },
    mkdir: async () => {},
    openWithSystem: async () => {},
    markdownTree: async (document: string, root: string) => {
      calls.markdownTree.push({ document, root });
      return answer;
    },
  };
  return { io, calls };
}

let sidebar: Sidebar;
let state: AppState;

beforeEach(() => {
  document.body.innerHTML = '<div id="sidebar" class="hidden"><div id="sidebar-tree"></div></div>';
  sidebar = setupSidebar();
  state = new AppState();
  state.filePath = DOC;
});

async function openByHand(io: PlatformIO): Promise<void> {
  let pending: Promise<void> = Promise.resolve();
  sidebar.setOnOpenByHand((ticket) => {
    pending = openSidebarByHand(state, sidebar, io, ticket);
  });
  sidebar.toggle();
  await pending;
}

/** The rows drawn, folders with a slash and a star when drawn open. */
function rows(): string[] {
  const out: string[] = [];
  const walk = (ul: Element, depth: number) => {
    for (const li of Array.from(ul.children)) {
      const folder = li.querySelector(':scope > .sidebar-folder-toggle');
      const file = li.querySelector(':scope > .sidebar-file-entry');
      const label = (folder ?? file)?.textContent?.replace(/^\W+/u, '').trim() ?? '';
      const children = li.querySelector(':scope > ul');
      const open = folder && children && !children.classList.contains('collapsed') ? '*' : '';
      out.push(`${'  '.repeat(depth)}${label}${folder ? '/' : ''}${open}`);
      if (children) walk(children, depth + 1);
    }
  };
  const top = document.querySelector('#sidebar-tree > ul');
  if (top) walk(top, 0);
  return out;
}

/** Arrive at `path` with the root a click or a link kept, by the route of `openDocumentAtPath`. */
async function arriveKeeping(path: string, root: TreeRoot | null, io: PlatformIO): Promise<void> {
  state.filePath = path;
  state.sidebarRootFromClick = root;
  await refreshSidebar(state, sidebar, io, 'document-arrived');
}

describe('A: the assets folders are drawn in the markdown tree', () => {
  it('with the files they hold, beside the markdown', async () => {
    const { io } = desktopIO({ files: FILES, reachedBound: false });
    await openByHand(io);
    expect(rows()).toEqual([
      'assets/',
      '  spare.png',
      '  used.png',
      'chapters/',
      '  assets/',
      '    scan.jpg',
      '  one.md',
      'plan.md',
    ]);
  });

  it('a document with nothing but its assets folder beside it draws the tree', async () => {
    const { io } = desktopIO({ files: ['plan.md', 'assets/used.png'], reachedBound: false });
    await openByHand(io);
    expect(rows()).toEqual(['assets/', '  used.png', 'plan.md']);
  });
});

describe('B: the grey of #380, unchanged', () => {
  let instance: EditorInstance;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    instance = createEditor(host);
    instance.setMarkdown('# Plan\n\n![used](assets/used.png)\n');
  });

  afterEach(() => {
    instance.destroy();
    host.remove();
  });

  function greyed(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>(`.${UNUSED_CLASS}`), (el) =>
      (el.dataset.path ?? '').replace(`${ROOT}/`, ''),
    );
  }

  it('greys the unused files of the assets folder of the document on screen, and no other', async () => {
    const { io } = desktopIO({ files: FILES, reachedBound: false });
    await openByHand(io);
    // What `main.ts` runs after every draw.
    sidebar.markUnused(unusedAssetFiles(instance.editor, state.filePath));
    expect(greyed()).toEqual(['assets/spare.png']);
  });
});

describe('C: a document opened from the markdown tree keeps it', () => {
  it('a click: the tree stays, with the assets folder of the document drawn open', async () => {
    const { io, calls } = desktopIO(
      { files: FILES, reachedBound: false },
      { existing: ['/notes/chapters/assets'] },
    );
    await openByHand(io);
    state.referencesImage = true;
    await arriveKeeping(SUB, sidebar.listedRoot(), io);
    expect(calls.markdownTree.at(-1)).toEqual({ document: SUB, root: ROOT });
    expect(calls.listDir).toEqual([]);
    expect(rows()).toEqual([
      'assets/',
      '  spare.png',
      '  used.png',
      'chapters/*',
      '  assets/*',
      '    scan.jpg',
      '  one.md',
      'plan.md',
    ]);
    expect(sidebar.listedRoot()).toEqual({ path: ROOT, markdown: true });
  });

  it('a save and an open by hand then draw the same tree', async () => {
    const { io } = desktopIO(
      { files: FILES, reachedBound: false },
      { existing: ['/notes/chapters/assets'] },
    );
    state.referencesImage = true;
    await arriveKeeping(SUB, { path: ROOT, markdown: true }, io);
    const drawn = rows();
    await refreshSidebar(state, sidebar, io, 'same-document');
    expect(rows()).toEqual(drawn);
    sidebar.toggle();
    await openByHand(io);
    expect(rows()).toEqual(drawn);
  });

  it('a relative link followed while the tree is shown keeps it as a click does (#727)', async () => {
    const { io, calls } = desktopIO(
      { files: FILES, reachedBound: false },
      { existing: [SUB, '/notes/chapters/assets'] },
    );
    await openByHand(io);
    state.referencesImage = true;
    let opened: { path: string; root?: TreeRoot } | null = null;
    await followRelativeLink(
      {
        documentPath: () => state.filePath,
        panelRoot: () => sidebar.listedRoot(),
        io: async () => io,
        openFilePath: async (path, root) => {
          opened = { path, root };
          await arriveKeeping(path, root ?? null, io);
        },
      },
      'chapters/one.md',
      false,
    );
    expect(opened).toEqual({ path: SUB, root: { path: ROOT, markdown: true } });
    expect(calls.listDir).toEqual([]);
    expect(rows()).toContain('chapters/*');
    expect(rows()).toContain('  assets/*');
  });

  it('a document without images opens no folder', async () => {
    const { io } = desktopIO(
      { files: FILES, reachedBound: false },
      { existing: ['/notes/chapters/assets'] },
    );
    state.referencesImage = false;
    await arriveKeeping(SUB, { path: ROOT, markdown: true }, io);
    expect(rows().filter((row) => row.endsWith('*'))).toEqual([]);
  });

  it('an assets folder beyond the tree: the tree as it is, nothing open, no move to assets/', async () => {
    const { io, calls } = desktopIO(
      { files: ['plan.md', 'chapters/one.md'], reachedBound: true },
      { existing: ['/notes/chapters/assets'] },
    );
    state.referencesImage = true;
    await arriveKeeping(SUB, { path: ROOT, markdown: true }, io);
    expect(calls.listDir).toEqual([]);
    expect(rows()).toEqual(['chapters/', '  one.md', 'plan.md']);
    expect(document.querySelector(`.${BOUND_LINE_CLASS}`)).not.toBeNull();
    expect(sidebar.listedRoot()).toEqual({ path: ROOT, markdown: true });
  });
});

describe('the routes that keep no root: as today (#402 F1)', () => {
  it('File, Open, a recent file or the file association: the panel raises itself on assets/ alone', async () => {
    const { io, calls } = desktopIO(
      { files: FILES, reachedBound: false },
      {
        existing: ['/notes/chapters/assets'],
        entries: {
          '/notes/chapters/assets': [
            { name: 'scan.jpg', path: '/notes/chapters/assets/scan.jpg', isDirectory: false },
          ],
        },
      },
    );
    state.referencesImage = true;
    await arriveKeeping(SUB, null, io);
    expect(calls.markdownTree).toEqual([]);
    expect(calls.listDir).toEqual(['/notes/chapters/assets']);
    expect(rows()).toEqual(['scan.jpg']);
    expect(sidebar.listedRoot()).toEqual({ path: '/notes/chapters/assets', markdown: false });
  });
});
