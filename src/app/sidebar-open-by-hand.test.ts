/**
 * #354 — the files panel, closed and opened again by hand, is drawn again.
 *
 * **What the panel holds is observable here**, so these rows drive the real
 * panel (`setupSidebar`) through the real routes: `toggle`, which the header
 * control and `Ctrl+Shift+E` both reach, and the handler `main.ts` installs,
 * which is `openSidebarByHand`. The browser branch is what this harness runs;
 * the desktop sentence is in `sidebar-open-desktop.test.ts`, because `isTauri`
 * is a module constant and `vi.mock` is per file.
 *
 * Measured before the change, through the same two routes: closed and opened
 * again, the panel held **0 characters** in every state — 13 of tree, 105 of
 * offer, and the two states with nothing all came back as an empty card.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { EntryPresence, FileEntry, PlatformIO } from '../platform/types';
import stylesCss from '../styles.css?raw';
import { reaches, stylesheetRules } from '../test-support/stylesheet-rules';
import { NO_FOLDER_ACCESS_OFFER, NO_RELATED_ITEMS, setupSidebar } from '../ui/sidebar';
import { openSidebarByHand, refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

interface Folder {
  /** Whether a grant speaks for the document; `false` is a browser with none. */
  granted?: boolean;
  /** What `entryPresence` answers for a path. */
  presence?: (path: string) => EntryPresence;
  /** Resolved before any answer is given, so a read can be held open. */
  gate?: Promise<void>;
}

function io(folder: Folder): PlatformIO {
  const held = async () => {
    if (folder.gate) await folder.gate;
  };
  const entries: Record<string, FileEntry[]> = {
    '/proj/notes': [{ name: 'cap1.md', path: '/proj/notes/cap1.md', isDirectory: false }],
  };
  return {
    supportsMultiFile: true,
    canWriteCompanions: async () => {
      await held();
      return folder.granted ?? true;
    },
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    readSnapshot: async () => ({ kind: 'absent' as const }),
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async (path: string) => (folder.presence ? folder.presence(path) : 'absent'),
    listDir: async (path: string) => entries[path] ?? [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

const TREE_BESIDE = (path: string): EntryPresence =>
  path === '/proj/notes' ? 'present' : 'absent';

/** The panel, wired the way `main.ts` wires it. */
function mount(filePath: string | null, folder: Folder) {
  document.body.innerHTML =
    '<aside id="sidebar" class="hidden"><div id="sidebar-tree"></div></aside>';
  const panel = document.getElementById('sidebar') as HTMLElement;
  const tree = document.getElementById('sidebar-tree') as HTMLElement;
  const sidebar = setupSidebar();
  const state = new AppState();
  state.filePath = filePath;
  const platform = { io: io(folder) };
  const reads: Array<Promise<void>> = [];
  sidebar.setOnOpenByHand((ticket) => {
    reads.push(openSidebarByHand(state, sidebar, platform.io, ticket));
  });
  return {
    panel,
    tree,
    sidebar,
    state,
    platform,
    reads,
    open: () => !panel.classList.contains('hidden'),
    /** Press the control, and wait for what the press started. */
    press: async () => {
      sidebar.toggle();
      await Promise.all(reads);
    },
    switchTo: () => refreshSidebar(state, sidebar, platform.io),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('opened again by hand, the panel shows what a fresh open would (#354)', () => {
  it('a document with a tree: the tree is there again', async () => {
    const view = mount('/proj/notes.md', { presence: TREE_BESIDE });
    await view.switchTo();
    expect(view.tree.textContent).toContain('cap1.md');

    await view.press();
    expect(view.open()).toBe(false);
    await view.press();

    expect(view.open()).toBe(true);
    expect(view.tree.textContent).toContain('cap1.md');
  });

  it('a new unsaved document: the line, never an empty card', async () => {
    const view = mount(null, {});
    await view.switchTo();
    expect(view.open()).toBe(false);

    await view.press();

    expect(view.open()).toBe(true);
    expect(view.tree.textContent).toBe(NO_RELATED_ITEMS);
  });

  it('a saved document with nothing beside it: the line', async () => {
    const view = mount('/proj/notes.md', {});
    await view.press();

    expect(view.tree.textContent).toBe(NO_RELATED_ITEMS);
  });

  it('the browser with no folder granted: the offer', async () => {
    const view = mount('notes.md', { granted: false });
    await view.switchTo();
    await view.press();
    await view.press();

    expect(view.tree.querySelector('.sidebar-access-offer')?.textContent).toBe(
      NO_FOLDER_ACCESS_OFFER,
    );
  });

  it('the browser with a grant that lapsed: the offer', async () => {
    const view = mount('/proj/notes.md', { presence: () => 'unknown' });
    await view.press();

    expect(view.tree.querySelector('.sidebar-access-offer')?.textContent).toBe(
      NO_FOLDER_ACCESS_OFFER,
    );
  });
});

describe('the #184 loop does not come back (#354)', () => {
  it('offer shown, accepted, hidden, opened by hand: the answer, not the offer', async () => {
    // The original sequence. Before #184 the hidden panel kept the offer and
    // the open by hand brought it back, true no longer, and each click on it
    // hid the panel again. Now the open by hand asks again, with the grant.
    const grant = { given: false };
    const view = mount('/proj/notes.md', {
      presence: (path) => (grant.given ? TREE_BESIDE(path) : 'unknown'),
    });
    await view.switchTo();
    expect(view.tree.querySelector('.sidebar-access-offer')).not.toBeNull();

    grant.given = true;
    await view.switchTo();
    view.sidebar.hide();
    await view.press();

    expect(view.tree.querySelector('.sidebar-access-offer')).toBeNull();
    expect(view.tree.textContent).toContain('cap1.md');
  });
});

describe('what a document switch shows is unchanged (#354)', () => {
  it('a switch into nothing beside the document stays silent', async () => {
    // Nobody asked, so no line: the silence R-C6 and R-A2 keep.
    const view = mount('/proj/notes.md', {});
    await view.switchTo();

    expect(view.open()).toBe(false);
    expect(view.tree.textContent).toBe('');
  });

  it('a hidden panel still holds nothing (#184)', async () => {
    const view = mount('/proj/notes.md', { presence: TREE_BESIDE });
    await view.press();
    expect(view.tree.textContent).toContain('cap1.md');

    await view.press();

    expect(view.tree.textContent).toBe('');
  });
});

describe('a read that lands late draws nothing (#354)', () => {
  function heldRead() {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { gate, release: () => release() };
  }

  it('closed before the read lands: the panel stays closed and empty', async () => {
    const read = heldRead();
    const view = mount('/proj/notes.md', { presence: TREE_BESIDE, gate: read.gate });

    view.sidebar.toggle();
    view.sidebar.toggle();
    read.release();
    await Promise.all(view.reads);

    expect(view.open()).toBe(false);
    expect(view.tree.textContent).toBe('');
  });

  it('opened, closed and opened again: the first read does not draw over the second', async () => {
    const first = heldRead();
    const view = mount('/proj/notes.md', { presence: TREE_BESIDE, gate: first.gate });
    view.sidebar.toggle();
    view.sidebar.toggle();
    const second = heldRead();
    view.platform.io = io({ gate: second.gate });
    view.sidebar.toggle();

    first.release();
    await view.reads[0];
    expect(view.tree.querySelector('.sidebar-reading'), 'still reading').not.toBeNull();

    second.release();
    await Promise.all(view.reads);
    expect(view.tree.textContent).toBe(NO_RELATED_ITEMS);
  });
});

describe('the mark while the folder is read (#354)', () => {
  it('is in the panel, and the panel says it is busy, until the answer lands', async () => {
    const read = { release: () => {} };
    const gate = new Promise<void>((resolve) => {
      read.release = resolve;
    });
    const view = mount('/proj/notes.md', { presence: TREE_BESIDE, gate });

    view.sidebar.toggle();
    expect(view.tree.querySelector('.sidebar-reading')).not.toBeNull();
    expect(view.tree.getAttribute('aria-busy')).toBe('true');

    read.release();
    await Promise.all(view.reads);
    expect(view.tree.querySelector('.sidebar-reading')).toBeNull();
    expect(view.tree.hasAttribute('aria-busy')).toBe(false);
  });

  it('is seen only after 200 ms, by the rule that reaches the mark the panel draws', () => {
    // Whether it is seen at all is layout and paint, and belongs to the
    // manual pass. What is held here is the rule: read out of the stylesheet
    // and run against the element the open by hand actually drew.
    const view = mount('/proj/notes.md', { gate: new Promise(() => {}) });
    view.sidebar.toggle();
    const mark = view.tree.querySelector('.sidebar-reading') as Element;
    const rule = stylesheetRules(stylesCss).find(
      (candidate) =>
        candidate.conditions.length === 0 &&
        reaches(candidate.selector, mark) &&
        candidate.declarations.has('animation'),
    );

    expect(rule?.declarations.get('opacity')).toBe('0');
    const animations = rule?.declarations.get('animation')?.split(',') ?? [];
    expect(animations).toHaveLength(2);
    for (const one of animations) expect(one).toContain('200ms');
  });
});
