import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTree, type TreeNode } from './sidebar';

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
