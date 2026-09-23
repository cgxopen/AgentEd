/**
 * #402 — the panel appears for an `assets/` folder the document uses, and
 * for nothing else.
 *
 * Three halves, each falling for its own reason. **A** is the rule that
 * left: a folder named after the document no longer opens the panel, on a
 * switch or by hand. **B** is the rule that stayed: an `assets/` folder the
 * document uses still does, by both routes. **D** is the rule that arrived
 * with the owner decision of 2026-09-21: an `assets/` folder the document
 * does **not** use raises nothing, because the panel is derived from
 * content rather than from the directory the document sits in — which is
 * what `ui/document-badges.ts` already says about the «Images» badge.
 *
 * Driven through `refreshSidebar` and `openSidebarByHand`, the two routes
 * R-C6 names, against a recording `Sidebar` — so what is asserted is what
 * the panel was told to show rather than what a decision function
 * returned. `sidebar-sync.test.ts` holds the decision itself.
 */
import { describe, expect, it } from 'vitest';
import { createEditor } from '../editor/setup';
import type { FileEntry, PlatformIO } from '../platform/types';
import { documentReferencesImage } from '../ui/document-badges';
import type { Sidebar, TreeNode } from '../ui/sidebar';
import { openSidebarByHand, refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

const DOC = '/proj/chapter.md';

/** `present` for each path given, `absent` for everything else. */
function io(present: string[], listing: Record<string, FileEntry[]> = {}): PlatformIO {
  const there = new Set(present);
  return {
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
    entryPresence: async (p: string) => (there.has(p) ? 'present' : 'absent'),
    listDir: async (p: string) => listing[p] ?? [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

interface Seen {
  sidebar: Sidebar;
  /** What the panel was last told, as the user would describe it. */
  showing: () => string;
  /** The names in the tree the panel was last given. */
  names: () => string[];
}

function recorder(): Seen {
  let last = 'hidden';
  let nodes: TreeNode[] = [];
  const sidebar: Sidebar = {
    showTree: (n: TreeNode[], _rootName: string, rootPath: string) => {
      last = `tree:${rootPath}`;
      nodes = n;
    },
    showNothingRelated: () => {
      last = 'No related files or folders';
    },
    showAccessOffer: () => {
      last = 'offer';
    },
    showUnreadable: () => {
      last = 'unreadable';
    },
    hide: () => {
      last = 'hidden';
    },
    isVisible: () => last !== 'hidden',
    toggle: () => {},
    setOnFileClick: () => {},
    onVisibleChange: () => {},
    setOnRequestAccess: () => {},
    isCurrent: () => true,
    beginSwitch: () => 0,
    isLatest: () => true,
    isClosedByHand: () => false,
    forgetClosedByHand: () => {},
    markUnused: () => {},
    setOnOpenByHand: () => {},
  };
  return { sidebar, showing: () => last, names: () => nodes.map((n) => n.name) };
}

/**
 * `usesTheFolder` is what `main.ts` writes on every transaction, from
 * `documentReferencesImage(editor)` — the same predicate the «Images»
 * badge is drawn from. Stated here rather than computed, so each row says
 * which of the two preconditions it is about.
 */
function stateAt(path: string, usesTheFolder: boolean): AppState {
  const state = new AppState();
  state.filePath = path;
  state.referencesImage = usesTheFolder;
  return state;
}

describe('A — a folder named after the document is not a trigger (#402)', () => {
  it('stays hidden on a document switch', async () => {
    const seen = recorder();
    await refreshSidebar(stateAt(DOC, true), seen.sidebar, io(['/proj/chapter']));
    expect(seen.showing()).toBe('hidden');
  });

  it('says No related files or folders when the panel is opened by hand', async () => {
    const seen = recorder();
    await openSidebarByHand(stateAt(DOC, true), seen.sidebar, io(['/proj/chapter']), 0);
    expect(seen.showing()).toBe('No related files or folders');
  });

  it('and the folder is not listed by either route', async () => {
    // The half that a test asserting only `hidden` would miss: the folder
    // is there and full, and nothing reaches it.
    const listing = {
      '/proj/chapter': [{ name: 'one.md', path: '/proj/chapter/one.md', isDirectory: false }],
    };
    const onSwitch = recorder();
    await refreshSidebar(stateAt(DOC, true), onSwitch.sidebar, io(['/proj/chapter'], listing));
    const byHand = recorder();
    await openSidebarByHand(stateAt(DOC, true), byHand.sidebar, io(['/proj/chapter'], listing), 0);
    expect([onSwitch.showing(), byHand.showing()]).toEqual([
      'hidden',
      'No related files or folders',
    ]);
  });
});

describe('B — an assets/ folder still is one (#402)', () => {
  const listing = {
    '/proj/assets': [{ name: 'diagram.png', path: '/proj/assets/diagram.png', isDirectory: false }],
  };

  it('shows the tree on a document switch', async () => {
    const seen = recorder();
    await refreshSidebar(stateAt(DOC, true), seen.sidebar, io(['/proj/assets'], listing));
    expect(seen.showing()).toBe('tree:/proj/assets');
  });

  it('shows the same tree when the panel is opened by hand', async () => {
    const seen = recorder();
    await openSidebarByHand(stateAt(DOC, true), seen.sidebar, io(['/proj/assets'], listing), 0);
    expect(seen.showing()).toBe('tree:/proj/assets');
  });

  it('lists what the assets folder holds, by both routes', async () => {
    // The half a row asserting only the root would miss: the tree is read
    // and drawn, not merely rooted.
    const onSwitch = recorder();
    await refreshSidebar(stateAt(DOC, true), onSwitch.sidebar, io(['/proj/assets'], listing));
    const byHand = recorder();
    await openSidebarByHand(stateAt(DOC, true), byHand.sidebar, io(['/proj/assets'], listing), 0);
    expect([onSwitch.names(), byHand.names()]).toEqual([['diagram.png'], ['diagram.png']]);
  });

  // **The #380 grey is not asserted here, and it is not out of reach
  // either.** The predicate `main.ts` hands to `markUnused` is built from
  // the document and its path rather than from the panel root, so nothing
  // about *which* files are grey depends on this change. What does depend
  // on it is whether there is a tree to grey at all: measured, breaking
  // the `assets/` probe turns **15 rows of `unused-assets.test.ts`** red.
  // So the grey is held there, on a larger fixture than this file has, and
  // repeating it here would be a second copy of the same guard.
});

describe('D — an assets/ folder the document does not use (#402)', () => {
  const listing = {
    '/proj/assets': [{ name: 'diagram.png', path: '/proj/assets/diagram.png', isDirectory: false }],
  };

  it('raises nothing on a document switch', async () => {
    const seen = recorder();
    await refreshSidebar(stateAt(DOC, false), seen.sidebar, io(['/proj/assets'], listing));
    expect(seen.showing()).toBe('hidden');
  });

  it('says No related files or folders when the panel is opened by hand', async () => {
    const seen = recorder();
    await openSidebarByHand(stateAt(DOC, false), seen.sidebar, io(['/proj/assets'], listing), 0);
    expect(seen.showing()).toBe('No related files or folders');
  });

  it('answers the same as the «Images» badge on that document, which is the point', () => {
    // The state measured before this rule: the badge withdrawn while the
    // panel listed three files and greyed all three. The badge predicate
    // is the one `main.ts` writes into the field the panel now reads, so
    // the two cannot disagree — asserted here as the empty document they
    // both answer about.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host);
    editor.setMarkdown('# Report\n\nJust prose, no pictures.\n');
    expect(documentReferencesImage(editor.editor)).toBe(false);
    editor.destroy();
    host.remove();
  });

  /**
   * The row above asserted the predicate on a document that never held an
   * image, and its comment said the two controls *cannot disagree* because
   * they read the same value. **They read it at different moments** (#418,
   * point f), and that window is what these two rows drive: the predicate
   * crosses on the edit, and the panel is asked again on that crossing.
   *
   * Measured on `7fd1550`, before the repair: the badge withdrew on the
   * transaction and the panel kept its tree, every file in it greyed, until
   * the next save.
   */
  it('the predicate crosses when the last image is deleted, which is the moment', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host);
    editor.setMarkdown('# Chapter\n\n![a](assets/photo.png)\n');
    expect(documentReferencesImage(editor.editor)).toBe(true);
    editor.setMarkdown('# Chapter\n\nThe picture is gone.\n');
    expect(documentReferencesImage(editor.editor)).toBe(false);
    editor.destroy();
    host.remove();
  });

  it('and the panel gives way on the value the crossing leaves behind', async () => {
    // The other half, and neither is worth anything alone: the row above is
    // the predicate moving, this one is the panel reading what it moved to.
    // What joins them — that `main.ts` asks again on the crossing and not on
    // an ordinary edit — is wiring, and the manual pass is where that is seen.
    const listing = {
      '/proj/assets': [{ name: 'photo.png', path: '/proj/assets/photo.png', isDirectory: false }],
    };
    const before = recorder();
    await refreshSidebar(stateAt(DOC, true), before.sidebar, io(['/proj/assets'], listing));
    expect(before.showing()).toBe('tree:/proj/assets');

    const after = recorder();
    await refreshSidebar(stateAt(DOC, false), after.sidebar, io(['/proj/assets'], listing));
    expect(after.showing()).toBe('hidden');
  });

  it('but a kept root is not demoted, because the user asked to be there', async () => {
    // A folder a click entered is a place rather than a claim about this
    // document, so #178 is untouched by the content rule.
    const state = stateAt(DOC, false);
    state.sidebarRootFromClick = '/proj/assets';
    const seen = recorder();
    await refreshSidebar(state, seen.sidebar, io(['/proj/assets'], listing));
    expect(seen.showing()).toBe('tree:/proj/assets');
  });
});

/**
 * Not a witness of its own, and measured rather than assumed: the row
 * below turns red under more than one reversal. It is kept because it
 * records the before and after of the one arrangement where the two folder
 * rules used to disagree.
 */
describe('both folders beside the document (#402)', () => {
  it('roots at assets/, where before this change it rooted at the named folder', async () => {
    const seen = recorder();
    await refreshSidebar(
      stateAt(DOC, true),
      seen.sidebar,
      io(['/proj/chapter', '/proj/assets'], {
        '/proj/assets': [{ name: 'a.png', path: '/proj/assets/a.png', isDirectory: false }],
      }),
    );
    expect(seen.showing()).toBe('tree:/proj/assets');
  });
});
