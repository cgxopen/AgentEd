import { basename, dirname, joinPath, stripExtension } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import type { ProfileId } from '../profiles/types';
import type { Sidebar, SidebarStatus } from '../ui/sidebar';
import { buildTree, type TreeNode } from '../ui/sidebar';
import type { AppState } from './state';

/** Maximum depth for the recursive directory walk that builds the tree. */
const MAX_LIST_DEPTH = 6;

export interface SidebarDecision {
  show: boolean;
  /** Absolute root for listing. Set only when `show === true`. */
  root?: string;
  /**
   * Hide the currently-open markdown file from the rendered tree —
   * relevant only when the file lives directly inside `root`
   * (parent-as-folder case). Other layouts list the file as a
   * sibling and rendering it is fine.
   */
  hideRootMd?: boolean;
}

/**
 * Decide whether the sidebar should be visible for the active document
 * and, if so, which directory becomes the listing root. ADR-030 D4
 * priority order:
 *
 *   1. llms-txt → never (the navigation index sits at a website root,
 *      where listing the surrounding tree is irrelevant)
 *   2. parent-as-folder (filename = `SKILL.md`, parent reachable) →
 *      root = parent directory; hide `SKILL.md` from the listing
 *   3. sibling layout (`<stripExtension>/` exists adjacent) → root =
 *      that adjacent folder
 *   4. plain with `<dirname>/assets/` adjacent → root = that `assets/`
 *      folder (consistent with M4 image-paste behaviour)
 *   5. otherwise → hidden
 */
export async function shouldShowSidebar(
  profile: ProfileId,
  filePath: string | null,
  io: PlatformIO,
): Promise<SidebarDecision> {
  if (!filePath) return { show: false };
  if (profile === 'llms-txt') return { show: false };

  if (basename(filePath).toLowerCase() === 'skill.md') {
    const parent = dirname(filePath);
    if (parent.length > 0 && parent !== '/' && (await io.exists(parent))) {
      return { show: true, root: parent, hideRootMd: true };
    }
  }

  const sibling = stripExtension(filePath);
  if (await io.exists(sibling)) {
    return { show: true, root: sibling, hideRootMd: false };
  }

  const parent = dirname(filePath);
  if (parent.length > 0 && parent !== '/') {
    const assetsDir = joinPath(parent, 'assets');
    if (await io.exists(assetsDir)) {
      return { show: true, root: assetsDir, hideRootMd: false };
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
 * root and renders a recursive tree. Status reflects whether the
 * companion folder looks well-formed (assets/ + .agented-meta.json).
 */
export async function refreshSidebar(
  state: AppState,
  sidebar: Sidebar,
  io: PlatformIO,
): Promise<void> {
  const decision = await shouldShowSidebar(state.profile, state.filePath, io);
  if (!decision.show || !decision.root) {
    sidebar.hide();
    return;
  }

  const root = decision.root;
  const flatEntries = await walkRecursive(io, root);

  const hiddenName = decision.hideRootMd && state.filePath ? basename(state.filePath) : null;
  const visible = hiddenName
    ? flatEntries.filter((e) => e.relativePath !== hiddenName)
    : flatEntries;

  const hasAssets = visible.some((e) => e.isDirectory && e.relativePath === 'assets');
  const hasMeta = visible.some((e) => !e.isDirectory && e.relativePath === '.agented-meta.json');
  const status: SidebarStatus =
    hasAssets && hasMeta
      ? { valid: true }
      : { valid: false, message: !hasMeta ? 'Companion metadata missing' : 'assets/ missing' };

  const tree: TreeNode[] = buildTree(
    visible.map((e) => ({
      path: e.relativePath,
      kind: e.isDirectory ? ('directory' as const) : ('file' as const),
    })),
  );

  const rootName = basename(root);
  sidebar.showTree(tree, rootName, root, status);
}
