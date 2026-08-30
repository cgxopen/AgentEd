import { isTauri } from '../platform/detect';
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
    // Those figures are **what #177 measured, on one machine**, and not
    // properties of this code: what carries is the shape — the walk is
    // linear in the entries and the cost that dominated was quadratic —
    // rather than any of the numbers.
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
 * when there is no root to list; otherwise lists the resolved root and
 * renders a recursive tree.
 *
 * Two ways to a root, in this order (R-C6, #178). The document's own
 * adjacent structure comes first and is unchanged, so a document opened
 * from the tree that carries a folder of its own still moves the panel
 * into it. Only when `shouldShowSidebar` finds none does the root the
 * click came from stand in — `state.sidebarRootFromClick`, which is set
 * on that route and `null` on every other one, so File then Open, the
 * file association and the context popover all hide exactly as they did.
 *
 * **When the panel first appears is not changed by any of this.** A
 * document that arrives with no adjacent structure and no kept root
 * hides the panel, which is the trigger R-C6 always had.
 */
export async function refreshSidebar(
  state: AppState,
  sidebar: Sidebar,
  io: PlatformIO,
): Promise<void> {
  const decision = await shouldShowSidebar(state.filePath, io);
  const root = decision.show && decision.root ? decision.root : state.sidebarRootFromClick;
  if (!root) {
    sidebar.hide();
    return;
  }

  const flatEntries = await walkRecursive(io, root);

  const tree: TreeNode[] = buildTree(
    flatEntries.map((e) => ({
      path: e.relativePath,
      kind: e.isDirectory ? ('directory' as const) : ('file' as const),
    })),
  );

  // **The platform fact is read here and passed down** (#146). A
  // non-markdown entry is actionable only where something can act on it,
  // and only the desktop can: `TauriIO.openWithSystem` reaches the host
  // shell where `WebIO` has nothing to reach. Read in this layer, which
  // already asks this question in `file-association.ts` and
  // `image-loader.ts`, and handed to the renderer as a value — so
  // `src/ui` keeps knowing nothing about the platform, and a test can
  // drive both answers in one file where a module-load constant would
  // need one file per answer.
  //
  // Not a field on `PlatformIO`, deliberately: that interface is built
  // by hand in twenty-two test files, and a new member would be
  // twenty-two edits to state something this layer already knows.
  sidebar.showTree(tree, basename(root), root, isTauri);
}
