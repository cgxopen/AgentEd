import { basename, dirname, joinPath, stripExtension } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import type { Sidebar } from '../ui/sidebar';
import { buildTree, type TreeNode } from '../ui/sidebar';
import type { AppState } from './state';

/** Maximum depth for the recursive directory walk that builds the tree. */
const MAX_LIST_DEPTH = 6;

export interface SidebarDecision {
  show: boolean;
  /** Absolute root for listing. Set only when `show === true`. */
  root?: string;
}

/**
 * Decide whether the sidebar should be visible for the active document
 * and, if so, which directory becomes the listing root (R-C6). The
 * trigger is adjacent structure — a folder that belongs to this
 * document — in this order:
 *
 *   1. sibling folder named after the file (`doc.md` + `doc/`) → root =
 *      that folder
 *   2. `<dirname>/assets/` adjacent → root = that `assets/` folder,
 *      matching where image paste writes
 *   3. otherwise → hidden
 */
export async function shouldShowSidebar(
  filePath: string | null,
  io: PlatformIO,
): Promise<SidebarDecision> {
  if (!filePath) return { show: false };

  // Both of these are positive claims — *this folder is there, and the
  // sidebar is rooted at it* — so only `present` may make them (#126).
  // They used to be made from a boolean that, after #58, answered `true`
  // for a lookup that never happened, which would root the panel at a
  // folder nobody had seen.
  const sibling = stripExtension(filePath);
  if ((await io.entryPresence(sibling)) === 'present') {
    return { show: true, root: sibling };
  }

  const parent = dirname(filePath);
  if (parent.length > 0 && parent !== '/') {
    const assetsDir = joinPath(parent, 'assets');
    if ((await io.entryPresence(assetsDir)) === 'present') {
      return { show: true, root: assetsDir };
    }
  }

  return { show: false };
}

/**
 * Recursively walk `root`, returning every entry as a `{ relativePath,
 * isDirectory }` pair. Stops at MAX_LIST_DEPTH to defend against runaway
 * symlink loops or pathologically deep trees. Entries that fail to list
 * (permission denied, transient FS error) are skipped silently.
 */
async function walkRecursive(
  io: PlatformIO,
  root: string,
): Promise<Array<{ relativePath: string; isDirectory: boolean }>> {
  const results: Array<{ relativePath: string; isDirectory: boolean }> = [];

  async function walk(currentPath: string, currentRelative: string, depth: number): Promise<void> {
    if (depth > MAX_LIST_DEPTH) return;
    let entries: Awaited<ReturnType<typeof io.listDir>>;
    try {
      entries = await io.listDir(currentPath);
    } catch {
      return;
    }
    // **Bounded in depth and deliberately not in breadth** (#174). Every
    // entry of every level is walked, and that is the measured answer rather
    // than an omission: once `buildTree` stopped rescanning its siblings, a
    // folder of 10,000 entries at one level cost **7.8 ms** through the whole
    // data chain — the walk and this loop 1.2 ms of it, the tree 3.6 ms, the
    // sort 0.4 ms. Before that change the same folder cost 277 ms, and every
    // millisecond of the difference was in one line of `buildTree`.
    //
    // So a breadth bound would cap what a reader is shown while the
    // enumeration it would be protecting them from has already happened —
    // `listDir` returns the whole level before this loop runs. That is the
    // shape #172 is about, and adding it here would be a product decision
    // about a sidebar that silently shows the first N entries, with no
    // performance argument under it. R-C6 describes no such thing.
    for (const entry of entries) {
      const relative = currentRelative ? joinPath(currentRelative, entry.name) : entry.name;
      results.push({ relativePath: relative, isDirectory: entry.isDirectory });
      if (entry.isDirectory) {
        await walk(joinPath(currentPath, entry.name), relative, depth + 1);
      }
    }
  }

  await walk(root, '', 0);
  return results;
}

/**
 * Refresh the sidebar to reflect the current document. Hides the panel
 * when shouldShowSidebar returns false; otherwise lists the resolved
 * root and renders a recursive tree.
 */
export async function refreshSidebar(
  state: AppState,
  sidebar: Sidebar,
  io: PlatformIO,
): Promise<void> {
  const decision = await shouldShowSidebar(state.filePath, io);
  if (!decision.show || !decision.root) {
    sidebar.hide();
    return;
  }

  const root = decision.root;
  const flatEntries = await walkRecursive(io, root);

  const tree: TreeNode[] = buildTree(
    flatEntries.map((e) => ({
      path: e.relativePath,
      kind: e.isDirectory ? ('directory' as const) : ('file' as const),
    })),
  );

  sidebar.showTree(tree, basename(root), root);
}
