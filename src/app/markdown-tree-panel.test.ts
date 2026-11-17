import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, MarkdownTree, PlatformIO } from '../platform/types';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import {
  BOUND_LINE_CLASS,
  BOUND_REACHED_TEXT,
  FOLDER_UNREADABLE,
  NO_RELATED_ITEMS,
  type Sidebar,
  setupSidebar,
  type TreeRoot,
} from '../ui/sidebar';
import { openSidebarByHand, refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

/**
 * The files panel opened by hand lists the markdown around the document (#746).
 *
 * The walk itself, what it keeps and leaves out, its depth and its two bounds,
 * is native and tested in `src-tauri/src/markdown_tree.rs`. Here the panel is
 * the real one, drawn into the page, and the routes are the real ones of
 * `sidebar-sync.ts`: which acts read a markdown tree, what is drawn from its
 * answer, and what a click in it keeps.
 */

const DOC = '/notes/plan.md';

interface Calls {
  markdownTree: Array<{ document: string; root: string }>;
  listDir: string[];
}

/** A desktop-shaped IO whose markdown tree answers `answer`, recording what was asked. */
function desktopIO(
  answer: MarkdownTree | (() => Promise<MarkdownTree>),
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
      return typeof answer === 'function' ? answer() : answer;
    },
  };
  return { io, calls };
}

function tree(files: string[], reachedBound = false): MarkdownTree {
  return { files, reachedBound };
}

let sidebar: Sidebar;
let state: AppState;

beforeEach(() => {
  document.body.innerHTML = '<div id="sidebar" class="hidden"><div id="sidebar-tree"></div></div>';
  sidebar = setupSidebar();
  state = new AppState();
  state.filePath = DOC;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Open the panel by hand, as the header control does, and wait for its answer. */
async function openByHand(io: PlatformIO): Promise<void> {
  let pending: Promise<void> = Promise.resolve();
  sidebar.setOnOpenByHand((ticket) => {
    pending = openSidebarByHand(state, sidebar, io, ticket);
  });
  sidebar.toggle();
  await pending;
}

/** The rows drawn, folders with a slash, in order, indented by level. */
function rows(): string[] {
  const out: string[] = [];
  const walk = (ul: Element, depth: number) => {
    for (const li of Array.from(ul.children)) {
      const folder = li.querySelector(':scope > .sidebar-folder-toggle');
      const file = li.querySelector(':scope > .sidebar-file-entry');
      const label = (folder ?? file)?.textContent?.replace(/^\W+/u, '').trim() ?? '';
      out.push(`${'  '.repeat(depth)}${label}${folder ? '/' : ''}`);
      const children = li.querySelector(':scope > ul');
      if (children) walk(children, depth + 1);
    }
  };
  const top = document.querySelector('#sidebar-tree > ul');
  if (top) walk(top, 0);
  return out;
}

function note(): string | null {
  return document.querySelector('.sidebar-note')?.textContent ?? null;
}

function boundLine(): Element | null {
  return document.querySelector(`.${BOUND_LINE_CLASS}`);
}

describe('opened by hand, with no assets/ tree', () => {
  it('lists the markdown files and the folders that hold them, from the folder of the document', async () => {
    const { io, calls } = desktopIO(
      tree(['plan.md', 'ideas.md', 'chapters/one.md', 'chapters/drafts/two.md']),
    );
    await openByHand(io);
    expect(calls.markdownTree).toEqual([{ document: DOC, root: '/notes' }]);
    expect(rows()).toEqual([
      'chapters/',
      '  drafts/',
      '    two.md',
      '  one.md',
      'ideas.md',
      'plan.md',
    ]);
    expect(sidebar.listedRoot()).toEqual({ path: '/notes', markdown: true });
    // The listing walk of the assets/ tree is not what draws it.
    expect(calls.listDir).toEqual([]);
  });

  it('answers No related files or folders when the only markdown is the document itself', async () => {
    const { io } = desktopIO(tree(['plan.md']));
    await openByHand(io);
    expect(note()).toBe(NO_RELATED_ITEMS);
    expect(rows()).toEqual([]);
  });

  it('draws the line under the tree when the read stopped at its bound, and only then', async () => {
    const { io } = desktopIO(tree(['plan.md', 'a/a.md'], true));
    await openByHand(io);
    expect(boundLine()?.textContent).toBe(BOUND_REACHED_TEXT);
    expect(boundLine()?.previousElementSibling).not.toBeNull();

    sidebar.toggle();
    const whole = desktopIO(tree(['plan.md', 'a/a.md'], false));
    await openByHand(whole.io);
    expect(rows()).toEqual(['a/', '  a.md', 'plan.md']);
    expect(boundLine()).toBeNull();
  });

  it('the line is styled as the line of hidden folders, by the selector the stylesheet ships', async () => {
    // How it looks is not observable here; what is: the rules of the shipped
    // sheet that reach the element the panel drew. The look itself is checked
    // by hand on the artifact.
    const { io } = desktopIO(tree(['plan.md', 'a/a.md'], true));
    await openByHand(io);
    const line = boundLine() as Element;
    const rules = stylesheetRules(stylesCss).filter((rule) => rule.conditions.length === 0);
    expect(valuesReaching(rules, line, 'font-size').at(-1)).toBe('12px');
    expect(valuesReaching(rules, line, 'color').at(-1)).toBe('var(--muted)');
    expect(valuesReaching(rules, line, 'padding').at(-1)).toBe('8px 12px 2px');
  });

  it('draws the tree and the line even when a stopped read found the document alone', async () => {
    // What was not read is not known to hold nothing.
    const { io } = desktopIO(tree(['plan.md'], true));
    await openByHand(io);
    expect(note()).toBeNull();
    expect(boundLine()?.textContent).toBe(BOUND_REACHED_TEXT);
  });

  it('answers This folder could not be read when the read is refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { io } = desktopIO(() =>
      Promise.reject(new Error('the document is not inside the root')),
    );
    await openByHand(io);
    expect(note()).toBe(FOLDER_UNREADABLE);
  });

  it('a build without the native read answers as before', async () => {
    const { io } = desktopIO(tree(['plan.md', 'ideas.md']));
    delete io.markdownTree;
    await openByHand(io);
    expect(note()).toBe(NO_RELATED_ITEMS);
  });

  it('an open by hand while a read runs joins it rather than starting a second walk', async () => {
    let release: (t: MarkdownTree) => void = () => {};
    const slow = new Promise<MarkdownTree>((resolve) => {
      release = resolve;
    });
    const { io, calls } = desktopIO(() => slow);
    const opens: Array<Promise<void>> = [];
    sidebar.setOnOpenByHand((ticket) => {
      opens.push(openSidebarByHand(state, sidebar, io, ticket));
    });
    sidebar.toggle(); // open
    sidebar.toggle(); // close while the read runs
    sidebar.toggle(); // open again
    release(tree(['plan.md', 'ideas.md']));
    await Promise.all(opens);
    expect(calls.markdownTree).toHaveLength(1);
    expect(rows()).toEqual(['ideas.md', 'plan.md']);
  });

  it('a save while the markdown tree is open draws it again rather than hiding it', async () => {
    const { io, calls } = desktopIO(tree(['plan.md', 'ideas.md']));
    await openByHand(io);
    await refreshSidebar(state, sidebar, io, 'same-document');
    expect(sidebar.isVisible()).toBe(true);
    expect(rows()).toEqual(['ideas.md', 'plan.md']);
    expect(calls.markdownTree).toHaveLength(2);
  });
});

describe('what does not change', () => {
  it('a document arriving reads no markdown tree and raises nothing (#402 F1)', async () => {
    const { io, calls } = desktopIO(tree(['plan.md', 'ideas.md']));
    await refreshSidebar(state, sidebar, io, 'document-arrived');
    expect(calls.markdownTree).toEqual([]);
    expect(sidebar.isVisible()).toBe(false);
  });

  it('a save with the panel closed opens no markdown tree', async () => {
    const { io, calls } = desktopIO(tree(['plan.md', 'ideas.md']));
    await refreshSidebar(state, sidebar, io, 'same-document');
    expect(calls.markdownTree).toEqual([]);
    expect(sidebar.isVisible()).toBe(false);
  });

  it('with assets/ present and used, opened by hand, the panel lists assets/ as before', async () => {
    state.referencesImage = true;
    const { io, calls } = desktopIO(tree(['plan.md', 'ideas.md']), {
      existing: ['/notes/assets'],
      entries: {
        '/notes/assets': [
          { name: 'photo.png', path: '/notes/assets/photo.png', isDirectory: false },
        ],
      },
    });
    await openByHand(io);
    expect(calls.markdownTree).toEqual([]);
    expect(calls.listDir).toEqual(['/notes/assets']);
    expect(rows()).toEqual(['photo.png']);
    expect(sidebar.listedRoot()).toEqual({ path: '/notes/assets', markdown: false });
  });

  it('with assets/ present and not used, opened by hand, the markdown tree is drawn', async () => {
    // An assets/ folder the document does not use is somebody else's folder
    // (#402), so the question gets the answer for a document without one.
    const { io, calls } = desktopIO(tree(['plan.md', 'ideas.md']), { existing: ['/notes/assets'] });
    await openByHand(io);
    expect(calls.markdownTree).toEqual([{ document: DOC, root: '/notes' }]);
    expect(rows()).toEqual(['ideas.md', 'plan.md']);
  });
});

describe('a click in the markdown tree (#178)', () => {
  it('keeps the root as a markdown tree, so the next document draws the same kind of tree', async () => {
    const { io, calls } = desktopIO(tree(['plan.md', 'chapters/one.md']));
    await openByHand(io);
    let kept: TreeRoot | null = null;
    sidebar.setOnFileClick((_absPath, root) => {
      kept = root;
    });
    const entry = Array.from(document.querySelectorAll<HTMLElement>('.sidebar-file-entry')).find(
      (el) => el.dataset.path === '/notes/chapters/one.md',
    );
    entry?.click();
    expect(kept).toEqual({ path: '/notes', markdown: true });

    // The route of today: the document arrives with the root the click kept.
    state.filePath = '/notes/chapters/one.md';
    state.sidebarRootFromClick = kept;
    await refreshSidebar(state, sidebar, io, 'document-arrived');
    expect(calls.markdownTree.at(-1)).toEqual({
      document: '/notes/chapters/one.md',
      root: '/notes',
    });
    expect(calls.listDir).toEqual([]);
    expect(rows()).toEqual(['chapters/', '  one.md', 'plan.md']);
    expect(sidebar.listedRoot()).toEqual({ path: '/notes', markdown: true });
  });

  it('a kept listing root is still walked as a listing', async () => {
    const { io, calls } = desktopIO(tree(['plan.md', 'ideas.md']), {
      entries: { '/notes': [{ name: 'photo.png', path: '/notes/photo.png', isDirectory: false }] },
    });
    state.sidebarRootFromClick = { path: '/notes', markdown: false };
    await refreshSidebar(state, sidebar, io, 'document-arrived');
    expect(calls.markdownTree).toEqual([]);
    expect(calls.listDir).toEqual(['/notes']);
    expect(rows()).toEqual(['photo.png']);
  });
});
