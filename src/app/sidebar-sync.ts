import { isTauri } from '../platform/detect';
import { basename, dirname, joinPath, stripExtension } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import type { Sidebar } from '../ui/sidebar';
import { buildTree, type TreeNode } from '../ui/sidebar';
import type { AppState } from './state';

/** Maximum depth for the recursive directory walk that builds the tree. */
const MAX_LIST_DEPTH = 6;

/**
 * What the panel should be, in three states rather than two (#184).
 *
 * A boolean answered *is there a tree* and nothing else, so the two ways
 * of having no tree arrived as one value. On the web they are not the
 * same thing: with no folder granted nothing was looked at, and an
 * absent panel then asserts something false about the document's
 * neighbourhood — the whole of this issue.
 *
 * **A discriminated union rather than a flag beside a boolean.** Two
 * booleans that have to be read together is how a third state gets lost
 * again, which is the shape #126 and #173 were both about.
 *
 * `no-folder-access` is `unknown` from `entryPresence`, which covers a
 * grant that was never given and one that lapsed or was revoked. That is
 * the right condition rather than an accident of it: in every one of
 * those states the panel's absence is a false statement, and the offer
 * to grant is the right move.
 */
export type SidebarDecision =
  | { readonly kind: 'tree'; readonly root: string }
  | { readonly kind: 'nothing-adjacent' }
  | { readonly kind: 'no-folder-access' };

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
  // No document has nothing beside it, and an offer here would be about
  // nothing: there is no neighbourhood to fail to see.
  if (!filePath) return { kind: 'nothing-adjacent' };

  // Both of these are positive claims — *this folder is there, and the
  // sidebar is rooted at it* — so only `present` may make them (#126).
  // They used to be made from a boolean that, after #58, answered `true`
  // for a lookup that never happened, which would root the panel at a
  // folder nobody had seen.
  //
  // **And what is not `present` is now kept apart** (#184). `absent` is
  // an answer from the folder; `unknown` is the admission that no folder
  // was asked. Both used to leave here as one `false`, one line after
  // `entryPresence` had told them apart.
  let nothingWasLookedAt = false;

  const sibling = stripExtension(filePath);
  const siblingPresence = await io.entryPresence(sibling);
  if (siblingPresence === 'present') return { kind: 'tree', root: sibling };
  nothingWasLookedAt = siblingPresence === 'unknown';

  const parent = dirname(filePath);
  if (parent.length > 0 && parent !== '/') {
    const assetsDir = joinPath(parent, 'assets');
    const assetsPresence = await io.entryPresence(assetsDir);
    if (assetsPresence === 'present') return { kind: 'tree', root: assetsDir };
    // Either probe answering `unknown` means the lookup did not happen.
    // Tracked rather than defaulted: a second probe that never ran must
    // not be recorded as having answered `absent`.
    nothingWasLookedAt = nothingWasLookedAt || assetsPresence === 'unknown';
  }

  return nothingWasLookedAt ? { kind: 'no-folder-access' } : { kind: 'nothing-adjacent' };
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

  // **The offer, and the one state that earns it** (#184). Nothing was
  // looked at, so the panel's absence would say something false about
  // this document's neighbourhood. `nothing-adjacent` gets no line: the
  // folder answered, and on the web the user picked it a moment ago, so
  // the absence is complete and they already know it — a permanent
  // notice there would be the shape #58, #61 and #130 refuse.
  //
  // Below a kept root, because a root a click asked to hold is a folder
  // that was granted: there is nothing to offer.
  const root = decision.kind === 'tree' ? decision.root : state.sidebarRootFromClick;
  if (!root) {
    if (decision.kind === 'no-folder-access') {
      sidebar.showAccessOffer();
      return;
    }
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
