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

  const sibling = stripExtension(filePath);
  if (await io.exists(sibling)) {
    return { show: true, root: sibling };
  }

  const parent = dirname(filePath);
  if (parent.length > 0 && parent !== '/') {
    const assetsDir = joinPath(parent, 'assets');
    if (await io.exists(assetsDir)) {
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
