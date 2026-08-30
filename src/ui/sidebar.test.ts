import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTree,
  NO_FOLDER_ACCESS_OFFER,
  NO_RELATED_ITEMS,
  NON_MARKDOWN_REASON,
  setupSidebar,
  type TreeNode,
} from './sidebar';

/**
 * `buildTree` builds the sidebar's tree from the flat listing the walk
 * returned. It had no test file at all until #174 — it is exported and was
 * exercised only through `refreshSidebar`, which asserts what the sidebar
 * shows rather than what the builder does.
 *
 * ── The two halves, and why neither implies the other ──
 *
 * The change #174 makes is a data structure: `current.children.find(...)`
 * became a `Map` from full path to node. That is a **shape** change, so the
 * first half asserts a shape — the sibling scan is gone — rather than a
 * time. A timing assertion is flaky on a shared runner and this project does
 * not have one; #163's precedent is that a measurement is a measurement and a
 * test is a test.
 *
 * The second half is the one a change like this breaks **silently**: a map
 * keyed on the wrong string — `name` instead of `path`, or the segment
 * instead of the prefix — builds a tree that is subtly wrong in a way no
 * existing test would catch, because until now nothing looked. So every
 * shape below was captured from the **quadratic** implementation before the
 * change and is asserted here byte for byte.
 */

type Entry = { path: string; kind: 'file' | 'directory' };

/** The tree as text: order, name, path and kind, one node per line. */
function outline(nodes: readonly TreeNode[], depth = 0): string {
  return nodes
    .flatMap((node) => [
      `${'  '.repeat(depth)}${node.name}${node.kind === 'directory' ? '/' : ''} [${node.path}]`,
      ...(node.children.length > 0 ? [outline(node.children, depth + 1)] : []),
    ])
    .join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildTree does no sibling scan (#174)', () => {
  it('never calls Array.prototype.find, whatever the width of a level', () => {
    // The whole of the defect, asserted as the operation that carried it.
    // `current.children.find((c) => c.path === partPath)` ran once per
    // segment of every entry and scanned the siblings already built, so one
    // level of N entries cost **N(N-1)/2** comparisons — measured on the
    // implementation this replaces: 4,950 at N=100, 499,500 at N=1,000 and
    // 49,995,000 at N=10,000, exactly N(N-1)/2 each time.
    //
    // A count of `find` *calls* would not have caught it: those are linear
    // either way, and the cost was inside each call. What separates the two
    // implementations is that the scan is not performed at all.
    const find = vi.spyOn(Array.prototype, 'find');

    buildTree(
      Array.from({ length: 500 }, (_, i) => ({
        path: `f${String(i).padStart(4, '0')}.md`,
        kind: 'file' as const,
      })),
    );

    expect(find).not.toHaveBeenCalled();
  });

  it('still reuses one node for a directory two entries share', () => {
    // The property the scan provided and the map has to keep: a path is one
    // node, not one per entry that mentions it. Asserted by identity rather
    // than by shape, because two structurally equal nodes would pass an
    // outline comparison and still be a bug.
    const tree = buildTree([
      { path: 'sub/one.md', kind: 'file' },
      { path: 'sub/two.md', kind: 'file' },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].path).toBe('sub/one.md');
    expect(tree[0].children[1].path).toBe('sub/two.md');
  });
});

/**
 * Every one of these was produced by the implementation #174 replaces and is
 * asserted unchanged. They are the shapes a map keyed on the wrong string
 * gets wrong, and each is here for a reason it can be named by.
 */
const SHAPES: ReadonlyArray<readonly [string, Entry[], string]> = [
  [
    'files at one level, sorted',
    [
      { path: 'b.md', kind: 'file' },
      { path: 'a.md', kind: 'file' },
      { path: 'c.md', kind: 'file' },
    ],
    'a.md [a.md]\nb.md [b.md]\nc.md [c.md]',
  ],
  [
    'a directory and its files',
    [
      { path: 'sub', kind: 'directory' },
      { path: 'sub/one.md', kind: 'file' },
      { path: 'sub/two.md', kind: 'file' },
    ],
    'sub/ [sub]\n  one.md [sub/one.md]\n  two.md [sub/two.md]',
  ],
  [
    'directories before files at the same level',
    [
      { path: 'z.md', kind: 'file' },
      { path: 'adir', kind: 'directory' },
      { path: 'adir/inner.md', kind: 'file' },
      { path: 'a.md', kind: 'file' },
    ],
    'adir/ [adir]\n  inner.md [adir/inner.md]\na.md [a.md]\nz.md [z.md]',
  ],
  [
    // The shape a map keyed on `name` collapses into one node.
    'the same name at three levels',
    [
      { path: 'notes', kind: 'directory' },
      { path: 'notes/notes', kind: 'directory' },
      { path: 'notes/notes/notes.md', kind: 'file' },
      { path: 'notes.md', kind: 'file' },
    ],
    'notes/ [notes]\n  notes/ [notes/notes]\n    notes.md [notes/notes/notes.md]\nnotes.md [notes.md]',
  ],
  [
    // `localeCompare`, not code points: lower case sorts first here, and a
    // map that deduplicated case-insensitively would lose two of the three.
    'siblings that differ only by case',
    [
      { path: 'Alpha.md', kind: 'file' },
      { path: 'alpha.md', kind: 'file' },
      { path: 'ALPHA.md', kind: 'file' },
    ],
    'alpha.md [alpha.md]\nAlpha.md [Alpha.md]\nALPHA.md [ALPHA.md]',
  ],
  [
    // `Á` sorts beside `a` rather than after `z`, which is the comparator
    // and not the builder — pinned so a change to either is visible.
    'names localeCompare orders differently from their code points',
    [
      { path: 'zebra.md', kind: 'file' },
      { path: 'Ápple.md', kind: 'file' },
      { path: 'apple.md', kind: 'file' },
      { path: 'Banana.md', kind: 'file' },
    ],
    'apple.md [apple.md]\nÁpple.md [Ápple.md]\nBanana.md [Banana.md]\nzebra.md [zebra.md]',
  ],
  [
    'a directory implied only by a deeper file',
    [{ path: 'a/b/c/deep.md', kind: 'file' }],
    'a/ [a]\n  b/ [a/b]\n    c/ [a/b/c]\n      deep.md [a/b/c/deep.md]',
  ],
  [
    // A node created as an intermediate keeps `directory` when a later entry
    // names the same path as a file. Not obviously right, and **not this
    // issue's to change**: it is what the scan did, so it is what the map
    // must do.
    'a path that arrives as a file after being implied as a directory',
    [
      { path: 'x/y.md', kind: 'file' },
      { path: 'x', kind: 'file' },
    ],
    'x/ [x]\n  y.md [x/y.md]',
  ],
  [
    'the same entry twice',
    [
      { path: 'dup.md', kind: 'file' },
      { path: 'dup.md', kind: 'file' },
    ],
    'dup.md [dup.md]',
  ],
];

describe('buildTree builds the tree it always built (#174)', () => {
  it.each(SHAPES)('%s', (_label, entries, expected) => {
    expect(outline(buildTree(entries))).toBe(expected);
  });

  it('builds nothing from nothing', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('reads a plausible tree out of every shape above', () => {
    // The guard on the guard, the shape `ci.test.ts` uses for the round-trip
    // documents: an `outline` that returned `''` for everything would make
    // every row above pass over an empty comparison, which is the silent
    // green #166 was caught by.
    for (const [label, entries, expected] of SHAPES) {
      expect(expected.length, `expected outline for "${label}" is empty`).toBeGreaterThan(0);
      expect(buildTree(entries).length, `"${label}" built no nodes`).toBeGreaterThan(0);
    }
  });
});

/**
 * #146 — a non-markdown entry is actionable only where something can act
 * on it.
 *
 * Both platform answers are driven **in one file**, which is the whole
 * reason the fact arrives as a parameter rather than being read from
 * `isTauri`: that is a module-load constant, so the pattern would be
 * `vi.mock` per file and the two halves could not sit beside each other
 * and be compared.
 *
 * The two halves fail for opposite reasons. A fix too wide makes the
 * desktop entry inert and breaks the second; a fix too narrow leaves the
 * web entry clickable and breaks the first. Neither implies the other.
 */
describe('#146 — an entry nothing can act on', () => {
  function show(opensNonMarkdown: boolean): {
    entries: Map<string, HTMLElement>;
    clicks: string[][];
  } {
    document.body.innerHTML =
      '<div id="sidebar"><div id="sidebar-tree"></div><button id="sidebar-close"></button></div>';
    const clicks: string[][] = [];
    const sidebar = setupSidebar();
    sidebar.setOnFileClick((absPath, rootPath) => {
      clicks.push([absPath, rootPath]);
    });
    sidebar.showTree(
      buildTree([
        { path: 'cap1.md', kind: 'file' },
        { path: 'note.txt', kind: 'file' },
      ]),
      'proiect',
      '/proiect',
      opensNonMarkdown,
    );
    const entries = new Map<string, HTMLElement>();
    for (const el of document.querySelectorAll<HTMLElement>('.sidebar-file-entry')) {
      entries.set(el.textContent?.trim().split(' ').pop() ?? '', el);
    }
    return { entries, clicks };
  }

  describe('in the browser, where nothing can hand a file to the host system', () => {
    it('the entry is still in the tree — present, not removed', () => {
      const { entries } = show(false);
      expect([...entries.keys()].sort()).toEqual(['cap1.md', 'note.txt']);
    });

    it('a click on it does nothing, because it carries no listener at all', () => {
      const { entries, clicks } = show(false);
      entries.get('note.txt')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicks).toEqual([]);
    });

    it('and it offers no affordance suggesting it would', () => {
      const { entries } = show(false);
      expect(entries.get('note.txt')!.classList.contains('sidebar-file-inert')).toBe(true);
    });

    it('the reason is the second line of its tooltip, and the path is still the first', () => {
      const { entries } = show(false);
      // Read from the module, not restated (#50). Two lines rather than
      // one was measured in both targets before this was written.
      expect(entries.get('note.txt')!.title).toBe(`note.txt\n${NON_MARKDOWN_REASON}`);
      expect(entries.get('note.txt')!.title.split('\n')).toHaveLength(2);
    });

    it('a markdown entry is untouched by any of it', () => {
      const { entries, clicks } = show(false);
      const md = entries.get('cap1.md')!;
      expect(md.classList.contains('sidebar-file-inert')).toBe(false);
      expect(md.title).toBe('cap1.md');
      md.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicks).toEqual([['/proiect/cap1.md', '/proiect']]);
    });
  });

  describe('on the desktop, where the OS default app can open it', () => {
    it('the entry still takes a click, and hands on the path it was built from', () => {
      const { entries, clicks } = show(true);
      entries.get('note.txt')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicks).toEqual([['/proiect/note.txt', '/proiect']]);
    });

    it('it is not marked inert, and its tooltip is the path and nothing else', () => {
      const { entries } = show(true);
      expect(entries.get('note.txt')!.classList.contains('sidebar-file-inert')).toBe(false);
      expect(entries.get('note.txt')!.title).toBe('note.txt');
    });
  });

  it('the two halves really differ, so neither passes vacuously', () => {
    const web = show(false).entries.get('note.txt')!;
    const desktop = show(true).entries.get('note.txt')!;
    expect(web.title).not.toBe(desktop.title);
    expect(web.className).not.toBe(desktop.className);
  });
});

/**
 * #184 — the offer the panel carries where a tree cannot be built.
 *
 * The wording is read from the module rather than restated (#50); it is
 * also recorded on the issue, which is the second place it can disagree
 * with — the gap found at the #186 review, where the shape was pinned
 * and the sentence was not.
 */
describe('#184 — the offer of folder access', () => {
  function mount(): {
    panel: HTMLElement;
    tree: HTMLElement;
    sidebar: ReturnType<typeof setupSidebar>;
  } {
    document.body.innerHTML =
      '<div id="sidebar" class="hidden"><div id="sidebar-tree"></div><button id="sidebar-close"></button></div>';
    return {
      panel: document.getElementById('sidebar')!,
      tree: document.getElementById('sidebar-tree')!,
      sidebar: setupSidebar(),
    };
  }

  it('shows the panel, holding the owner sentence and nothing else', () => {
    const { panel, tree, sidebar } = mount();
    sidebar.showAccessOffer();

    expect(panel.classList.contains('hidden')).toBe(false);
    const offer = tree.querySelector('.sidebar-access-offer');
    expect(offer?.textContent).toBe(NO_FOLDER_ACCESS_OFFER);
    expect(tree.querySelectorAll('.sidebar-file-entry')).toHaveLength(0);
  });

  it('is a button, so the keyboard reaches it on its own terms', () => {
    const { tree, sidebar } = mount();
    sidebar.showAccessOffer();
    const offer = tree.querySelector('.sidebar-access-offer');
    expect(offer?.tagName).toBe('BUTTON');
  });

  it('a click runs the handler that asks for the folder', () => {
    const { tree, sidebar } = mount();
    let asked = 0;
    sidebar.setOnRequestAccess(() => {
      asked += 1;
    });
    sidebar.showAccessOffer();
    tree.querySelector<HTMLElement>('.sidebar-access-offer')!.click();
    expect(asked).toBe(1);
  });

  it('a tree drawn afterwards replaces it, leaving nothing of it behind', () => {
    const { tree, sidebar } = mount();
    sidebar.showAccessOffer();
    sidebar.showTree(buildTree([{ path: 'cap1.md', kind: 'file' }]), 'proiect', '/proiect', false);
    expect(tree.querySelector('.sidebar-access-offer')).toBeNull();
    expect(tree.querySelectorAll('.sidebar-file-entry')).toHaveLength(1);
  });

  it('and the offer replaces a tree, in the other direction', () => {
    const { tree, sidebar } = mount();
    sidebar.showTree(buildTree([{ path: 'cap1.md', kind: 'file' }]), 'proiect', '/proiect', false);
    sidebar.showAccessOffer();
    expect(tree.querySelectorAll('.sidebar-file-entry')).toHaveLength(0);
    expect(tree.querySelector('.sidebar-access-offer')).not.toBeNull();
  });
});

/**
 * #184 — a hidden panel holds nothing.
 *
 * Found by the owner: accepting the offer granted the folder, the panel
 * correctly had nothing to show and hid — and opening it by hand brought
 * the same offer line back, because `hide` had left it in the DOM. It
 * was still clickable and no longer true, so each click hid the panel
 * again. A loop with no way out of it.
 */
describe('#184 — hide empties the panel', () => {
  function mount() {
    document.body.innerHTML =
      '<div id="sidebar" class="hidden"><div id="sidebar-tree"></div><button id="sidebar-close"></button></div>';
    return {
      panel: document.getElementById('sidebar')!,
      tree: document.getElementById('sidebar-tree')!,
      sidebar: setupSidebar(),
    };
  }

  it('a toggle after hiding the offer does not bring the offer back', () => {
    const { tree, sidebar } = mount();
    sidebar.showAccessOffer();
    sidebar.hide();
    sidebar.toggle();

    expect(tree.querySelector('.sidebar-access-offer')).toBeNull();
  });

  it('and a toggle after hiding a tree does not bring the tree back', () => {
    const { tree, sidebar } = mount();
    sidebar.showTree(buildTree([{ path: 'cap1.md', kind: 'file' }]), 'proiect', '/proiect', false);
    sidebar.hide();
    sidebar.toggle();

    expect(tree.querySelectorAll('.sidebar-file-entry')).toHaveLength(0);
  });

  it('the panel still opens and closes, which is what toggle is for', () => {
    const { panel, sidebar } = mount();
    sidebar.showAccessOffer();
    expect(panel.classList.contains('hidden')).toBe(false);
    sidebar.hide();
    expect(panel.classList.contains('hidden')).toBe(true);
    sidebar.toggle();
    expect(panel.classList.contains('hidden')).toBe(false);
  });
});

describe('#184 — the answer when the folder holds nothing', () => {
  function mount() {
    document.body.innerHTML =
      '<div id="sidebar" class="hidden"><div id="sidebar-tree"></div><button id="sidebar-close"></button></div>';
    return {
      panel: document.getElementById('sidebar')!,
      tree: document.getElementById('sidebar-tree')!,
      sidebar: setupSidebar(),
    };
  }

  it('shows the panel, holding the owner sentence', () => {
    const { panel, tree, sidebar } = mount();
    sidebar.showNothingRelated();

    expect(panel.classList.contains('hidden')).toBe(false);
    expect(tree.querySelector('.sidebar-note')?.textContent).toBe(NO_RELATED_ITEMS);
  });

  it('takes no click, because nothing here is an action', () => {
    const { tree, sidebar } = mount();
    let asked = 0;
    sidebar.setOnRequestAccess(() => {
      asked += 1;
    });
    sidebar.showNothingRelated();

    const note = tree.querySelector<HTMLElement>('.sidebar-note')!;
    expect(note.tagName).toBe('DIV');
    note.click();
    expect(asked).toBe(0);
  });

  it('replaces the offer, and is replaced by a tree, leaving nothing behind', () => {
    const { tree, sidebar } = mount();
    sidebar.showAccessOffer();
    sidebar.showNothingRelated();
    expect(tree.querySelector('.sidebar-access-offer')).toBeNull();

    sidebar.showTree(buildTree([{ path: 'cap1.md', kind: 'file' }]), 'proiect', '/proiect', false);
    expect(tree.querySelector('.sidebar-note')).toBeNull();
    expect(tree.querySelectorAll('.sidebar-file-entry')).toHaveLength(1);
  });

  it('and the three sentences are different from each other', () => {
    expect(new Set([NO_RELATED_ITEMS, NO_FOLDER_ACCESS_OFFER, NON_MARKDOWN_REASON]).size).toBe(3);
  });
});
