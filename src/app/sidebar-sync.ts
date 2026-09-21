import { isTauri } from '../platform/detect';
import { basename, dirname, joinPath } from '../platform/paths';
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
 * and, if so, which directory becomes the listing root (R-C6).
 *
 * **The trigger is one folder and one only: `assets/` beside the
 * document** — where image paste writes, which is the only folder rule
 * AgentEd keeps (#402, owner decision F1). If it is there the panel
 * roots at it; otherwise the panel is hidden.
 *
 * There used to be a second trigger before it, a sibling folder named
 * after the file (`doc.md` + `doc/`). It left with #402, and the loss is
 * stated in R-C6 rather than left to be met: a `chapter.md` with a
 * `chapter/` folder beside it no longer shows that folder, and that was
 * the only way the panel ever showed a folder of documents.
 */
export async function shouldShowSidebar(
  filePath: string | null,
  io: PlatformIO,
): Promise<SidebarDecision> {
  // No document has nothing beside it, and an offer here would be about
  // nothing: there is no neighbourhood to fail to see.
  if (!filePath) return { kind: 'nothing-adjacent' };

  // **Does the granted folder speak for this document at all** (#184,
  // and the hole is #147's). On the web a document's path is a name
  // resolved against the grant, and a Save As can leave the document in
  // one folder and the grant in another — `acquireDirectoryHandle`
  // swallows a cancelled picker, so the old grant simply stays.
  //
  // Everything below then answers about the wrong folder. Measured: a
  // document saved as `web.md` into a folder with nothing beside it,
  // while the grant still held the folder it came from, rooted the panel
  // at that folder's `web/` and listed four files that are not beside
  // the document. The entries are clickable, so a click opened a file
  // from the other tree.
  //
  // `canWriteCompanions` is the predicate #147 built for exactly this
  // split — it asks whether the grant can name a companion **beside
  // this document**, which is the same question a tree asks. Its name is
  // about writing and its meaning is about the neighbourhood; that was
  // worth one sentence rather than a rename at one consumer, and the
  // trade was re-examined at three and kept on numbers (#201). One name,
  // three questions - write, read, neighbourhood - and five of the seven
  // callers ask the one the name states. No disagreement between the two
  // platforms is reachable by any of them: on the web all three reduce to
  // the same grant, and on the desktop the answer is a path-shape check
  // whose false branch no Windows path reaches, held in
  // `platform/tauri.test.ts`.
  //
  // `no-folder-access` rather than `nothing-adjacent`, because nothing
  // about *this document's* neighbourhood was established — and on the
  // web the offer then hands the user the one act that repairs it.
  if (!(await io.canWriteCompanions(filePath))) return { kind: 'no-folder-access' };

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

  // **The empty parent is the web document at the root of its grant, and
  // it is probed rather than skipped** (#402). `dirname` of a bare name
  // answers `''`, and the guard here used to read `parent.length > 0`, so
  // that document never had its `assets/` looked for at all: measured on
  // `7cd4984` through the real `WebIO` with a grant, a document at the
  // grant root with `assets/` beside it got no panel, while the same
  // arrangement one level down got the tree. The sibling rule was the only
  // thing that ever opened the panel there, so removing it above would
  // have left the arrangement this issue is about answering differently on
  // the two platforms. `joinPath('', 'assets')` answers `assets`, which is
  // what `WebIO` reads against the grant, so nothing new is built here.
  //
  // **The desktop does not reach this**, and the check that keeps it out is
  // one step above rather than here: `TauriIO.canWriteCompanions` refuses a
  // bare name, so such a path leaves as `no-folder-access` before any probe
  // runs. Held in `platform/tauri.test.ts`.
  //
  // `parent !== '/'` stays: a document at the filesystem root has no
  // neighbourhood worth probing, and that is a desktop shape.
  const parent = dirname(filePath);
  if (parent !== '/') {
    const assetsDir = joinPath(parent, 'assets');
    const assetsPresence = await io.entryPresence(assetsDir);
    if (assetsPresence === 'present') return { kind: 'tree', root: assetsDir };
    // The probe answering `unknown` means the lookup did not happen.
    // Tracked rather than defaulted: a probe that never ran must not be
    // recorded as having answered `absent`.
    nothingWasLookedAt = assetsPresence === 'unknown';
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
 * What the panel holds for the current document, decided and read but not
 * yet drawn (#354). Four answers, because an open by hand and a document
 * switch draw the last two differently: a switch hides for both, and an open
 * by hand answers each with its own sentence.
 */
export type SidebarView =
  | {
      readonly kind: 'tree';
      readonly nodes: TreeNode[];
      readonly rootName: string;
      readonly rootPath: string;
      readonly opensNonMarkdown: boolean;
    }
  | { readonly kind: 'offer' }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'unreadable' };

/**
 * Decide what the panel holds for the current document, and read the folder
 * when it holds a tree.
 *
 * Two ways to a root, in this order (R-C6, #178). The document's own
 * `assets/` folder comes first, so a document opened from the tree that
 * has one of its own still moves the panel into it. Only when
 * `shouldShowSidebar` finds none does the root the click came from stand
 * in — `state.sidebarRootFromClick`, which is set on that route and
 * `null` on every other one, so File then Open and the file association
 * both hide exactly as they did.
 *
 * **The kept root carries more after #402 than before it.** With the
 * sibling rule gone, every document that used to root on a folder of its
 * own now falls through to this line instead, so the route below is
 * reached more often rather than less.
 */
export async function resolveSidebarView(state: AppState, io: PlatformIO): Promise<SidebarView> {
  const decision = await shouldShowSidebar(state.filePath, io);

  // **An `assets/` folder the document does not use is somebody else's
  // folder** (#402, owner decision). The trigger is the folder *and* a
  // document that references an image, so the panel describes this
  // document rather than the directory it happens to sit in — which is
  // the reasoning `ui/document-badges.ts` gives for the «Images» badge
  // withdrawing in exactly this state, inherited here so the two controls
  // cannot answer the same document differently. Measured before this
  // change, on a document referencing no image with three files beside
  // it: the badge was withdrawn while the panel listed all three and
  // greyed all three, which is the panel saying three times that none of
  // this belongs to what you are reading.
  //
  // **Written as a demotion of the tree rather than an early return**, so
  // everything below is reached exactly as before: `no-folder-access`
  // still earns the offer, and `nothing-adjacent` still reaches
  // `showNothingRelated` on the by-hand route (#354), which is the
  // sentence this decision asks for and which costs no line of its own.
  //
  // **A kept root is not demoted.** It is a folder the user clicked into,
  // so it is a place they asked to be rather than a claim about this
  // document, and the #178 route is untouched by this.
  const used =
    decision.kind === 'tree' && !state.referencesImage
      ? ({ kind: 'nothing-adjacent' } as const)
      : decision;

  // **The offer, and the two things that earn it** (#184). Nothing was
  // looked at, so the panel's absence would say something false about
  // this document's neighbourhood — and there has to be a grant to
  // offer.
  //
  // `nothing-adjacent` gets no line **on a document switch**: the folder
  // answered, and on the web the user picked it a moment ago, so the absence
  // is complete and they already know it. A permanent notice there is the
  // shape #58, #61 and #130 refuse. An open by hand is a question and does
  // get the line (#354); that is `openSidebarByHand`, below.
  //
  // **`isTauri` decides offer or unreadable, and it is not belt-and-braces.** `unknown` is the same
  // value on both platforms and does not mean the same thing.
  // `TauriIO.entryPresence` answers it when `fsExists` throws — a
  // path that cannot be read, which is #58's family — where `WebIO`
  // answers it when no folder was ever granted. Only the second has a
  // grant to offer, and the desktop line would be a sentence about
  // folder access on a build with no such notion, over a click that
  // `requestFolderAccess` answers `false` to. An unreadable path on the
  // desktop is `unreadable` instead: a document switch keeps the behaviour
  // it had, which is hidden, and whether that silence is right is #58's
  // question; an open by hand says the folder could not be read (#354).
  //
  // **What would replace the flag**, which CLAUDE.md asks be named beside
  // it and which was missing here until #201. The question underneath is
  // whether this build can acquire a grant at all, and
  // `requestFolderAccess` in `platform/index.ts` already owns it - it
  // answers `false` on the desktop, where nothing grants. It cannot be
  // asked here, because it is an act rather than a query: it opens the
  // directory picker, so calling it to decide whether to offer a folder
  // would be asking for the folder. Until something answers that question
  // without performing it, the platform name is the only answer available.
  //
  // **And only one of the two routes to `no-folder-access` reaches this
  // line on the desktop.** The predicate at the top of `shouldShowSidebar`
  // is a path-shape check there, and no shape a Windows picker returns
  // reaches its false branch - the two false answers need a POSIX
  // filesystem root or a bare name. Measured through the real `TauriIO`
  // and held in `platform/tauri.test.ts`. What does reach here on the
  // desktop is the `nothingWasLookedAt` route, `entryPresence` answering
  // `unknown`, which is the case the paragraph above is about. So the flag
  // is carrying that second route rather than the first.
  //
  // Below a kept root, because a root a click asked to hold is a folder
  // that was granted: there is nothing to offer.
  const root = used.kind === 'tree' ? used.root : state.sidebarRootFromClick;
  if (!root) {
    if (used.kind === 'no-folder-access') return { kind: isTauri ? 'unreadable' : 'offer' };
    return { kind: 'nothing' };
  }

  const flatEntries = await walkRecursive(io, root);

  const nodes: TreeNode[] = buildTree(
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
  return {
    kind: 'tree',
    nodes,
    rootName: basename(root),
    rootPath: root,
    opensNonMarkdown: isTauri,
  };
}

/**
 * Why the panel is drawn again (#387): a document arrived on screen, or the
 * document already there was written or read again.
 */
export type SidebarRedraw = 'document-arrived' | 'same-document';

/** Draw a tree answer; the one draw both routes share. */
function drawTree(sidebar: Sidebar, view: Extract<SidebarView, { kind: 'tree' }>): void {
  sidebar.showTree(view.nodes, view.rootName, view.rootPath, view.opensNonMarkdown);
}

/**
 * Refresh the sidebar to reflect the current document, on a document switch.
 * Hides the panel when there is no root to list; otherwise lists the resolved
 * root and renders a recursive tree.
 *
 * **When the panel first appears is not changed by any of this.** A
 * document that arrives with no `assets/` folder and no kept root hides
 * the panel — the trigger R-C6 has had since #402, and before it the
 * same sentence with two folders instead of one. **Nobody asked**,
 * so `nothing` and `unreadable` both hide, silently (#354).
 *
 * **A read that lands after anything else was asked of the panel draws
 * nothing** (#380). Until then a switch took no ticket, so closing the panel
 * by hand while a switch read the folder opened it again when the read
 * landed, measured on the #380 step zero.
 *
 * **A redraw of the same document never opens a panel closed by hand**
 * (#387): a save, a Save As and a reload after an external change are not
 * acts that ask for the panel under R-C6, so they redraw it while it is open
 * and leave it closed once the person closed it. A document arriving is one,
 * so it forgets the close, and the panel appears for a document with
 * structure as it always did.
 */
export async function refreshSidebar(
  state: AppState,
  sidebar: Sidebar,
  io: PlatformIO,
  redraw: SidebarRedraw = 'document-arrived',
): Promise<void> {
  if (redraw === 'document-arrived') sidebar.forgetClosedByHand();
  else if (sidebar.isClosedByHand()) return;
  const ticket = sidebar.beginSwitch();
  const view = await resolveSidebarView(state, io);
  if (!sidebar.isLatest(ticket)) return;
  if (view.kind === 'tree') drawTree(sidebar, view);
  else if (view.kind === 'offer') sidebar.showAccessOffer();
  else sidebar.hide();
}

/**
 * Draw the panel the user has just opened by hand (#354). **An open by hand
 * is a question**, the line R-A2 draws for Refresh, so every state answers:
 * the tree, the offer, or one of the two sentences — never an empty card.
 *
 * **Nothing is drawn unless `ticket` is still current.** The panel opened
 * before the folder was read, and every `show*` opens it; a read that landed
 * after the user closed it again would reopen it by itself. The same holds
 * for a read overtaken by a newer open or by a document switch.
 *
 * A read that throws is answered as a folder that could not be read, which is
 * what it is; the reading mark is not left spinning.
 */
export async function openSidebarByHand(
  state: AppState,
  sidebar: Sidebar,
  io: PlatformIO,
  ticket: number,
): Promise<void> {
  let view: SidebarView;
  try {
    view = await resolveSidebarView(state, io);
  } catch (e) {
    console.error('[agented] the files panel could not be read:', e);
    view = { kind: 'unreadable' };
  }
  if (!sidebar.isCurrent(ticket)) return;
  if (view.kind === 'tree') drawTree(sidebar, view);
  else if (view.kind === 'offer') sidebar.showAccessOffer();
  else if (view.kind === 'nothing') sidebar.showNothingRelated();
  else sidebar.showUnreadable();
}
