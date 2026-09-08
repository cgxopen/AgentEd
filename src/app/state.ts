import type { ContextCluster } from '../cluster/types';
import { DEFAULT_LINE_CONVENTIONS, type LineConventions } from '../formats/line-conventions';

/**
 * Central mutable state for the app. All handlers read/write through a
 * single AppState instance so extracted modules can share it without
 * reaching for module-level `let` bindings in main.ts.
 *
 * `modified` is the only field with a subscription API because it is the
 * only flag that drives DOM (modified indicator + Close button enable).
 *
 * A document is a plain `.md` file: a path, its frontmatter block (if
 * any), and the dirty flag. There is no document mode and no profile —
 * both left with the August 2026 reset.
 */
export class AppState {
  filePath: string | null = null;
  isFirstSave = true;
  isSaving = false;
  /**
   * The folder the user has *agreed* to an `assets/` directory in,
   * remembered per folder rather than per session and asked once (#14,
   * #45).
   *
   * Keyed by directory because the folder is no longer created at the
   * moment it is agreed to: without the creation to make the second
   * insert find `exists: true`, a boolean would re-open the dialog for
   * every image pasted before the first save. Keying on the path also
   * gives the honest answer after a Save As into a different folder —
   * that is a different folder to consent to, so it is asked about.
   *
   * **Only an agreement is remembered** (#66). A refusal cancels the
   * image it was asked about and nothing more, so the next insert asks
   * again — the same as cancelling the destination picker one gesture
   * earlier. Remembering a *yes* saves the user a repeated dialog;
   * remembering a *no* silently removed the feature for the life of the
   * document.
   *
   * **It belongs to the folder, not to the document** (#51, R-C5), so
   * `resetDocument` deliberately does not clear it: every document
   * edited in this window inserts into an agreed folder without being
   * asked again. It ends with the window, which is a real limit —
   * R-C8 gives each window its own `AppState`.
   */
  assetsDirConfirmedFor: string | null = null;

  /**
   * Exactly the text AgentEd last read from, or wrote to, `filePath` —
   * what it believes is on disk right now. The save flow compares the
   * file against this before writing, so a change made by another
   * program, a sync client or a second AgentEd window is caught instead
   * of being silently overwritten (R-C14).
   *
   * `null` means *nothing is known about this path*, which is not the
   * same as "unchanged": it is the state of a fresh document, and of a
   * Save As destination the editor never opened. Nothing is known, so
   * nothing is claimed and nothing is asked — that path's protection is
   * the save picker's own replace question.
   *
   * It travels with the path, and every place that moves the document
   * to a different file must clear it, or the next save compares one
   * file against another file's text. Set on open and after every
   * successful write (**including** a save whose images failed, since
   * the `.md` did reach the disk — otherwise the retry that failure
   * invites would accuse AgentEd of its own write). Cleared on New /
   * Close by `resetDocument` and by `requestSaveAs`; on **Open** it is
   * *replaced* by `applyBundle`, which records the text it just read.
   * The distinction matters because the open path does not go through
   * `resetDocument` at all — the fact #51 turned on.
   */
  knownDiskText: string | null = null;

  /**
   * How this document's text is written back: line terminator and
   * final newline (#79). They belong to the **content**, not to the
   * path — which is what separates them from `knownDiskText` above.
   *
   * Set on open, from the text that was read. Reset to the default
   * (`\n`, final newline) by `resetDocument`, so New and New from
   * Template are written the way every other tool writes markdown.
   * **Not** cleared by `requestSaveAs`: a CRLF document saved under a
   * new name is still a CRLF document, whereas what AgentEd knew about
   * the old path says nothing about the new one.
   */
  /**
   * Whether the open document's file began with a byte order mark
   * (#259). Beside the line conventions and for the same reason: it is
   * a property of the file, carried so that saving puts it back.
   * `false` for a document that was never read from disk, which is what
   * AgentEd writes for a new one.
   */
  byteOrderMark = false;

  lineConventions: LineConventions = DEFAULT_LINE_CONVENTIONS;

  /**
   * Whether this document has already been told that naming a
   * destination is not a save (#48). The cue explains the silence that
   * follows the first insert into a document with no file on disk;
   * repeating it for every pasted image would be noise, so it is shown
   * once per document and cleared in `resetDocument()`.
   *
   * **It is per document where the assets/ agreement above is per
   * folder** (#51), and the two part company here deliberately: what
   * the cue explains is *this* document's silence, so a new document
   * has its own silence to explain. Nothing about a folder is said in
   * it.
   */
  destinationCueShown = false;

  /**
   * The listing root a sidebar click asked the panel to keep (#178).
   *
   * The panel's only action used to dissolve the panel: a document
   * opened from the tree is almost never a document that carries a
   * folder of its own, and `shouldShowSidebar` roots at nothing else, so
   * the tree went with the first click. Owner decision of 2026-08-29:
   * the document's own adjacent structure still wins and the panel
   * descends into it; where there is none, the root the click came from
   * stands in.
   *
   * `null` means *this document did not arrive from the panel*, which is
   * every other route — File then Open, the command line, the file
   * association, the context popover, a reload after an external change
   * — and each of them re-derives the root exactly as before. Set and
   * cleared in one place, `loadBundleFromPath`, because that is the set
   * of *a document arrived at a path* events; a save is not one of them,
   * so Ctrl+S on a document opened from the tree does not dissolve it.
   *
   * **It never reaches disk**, and nothing here would let it: `AppState`
   * is in-memory and per window (R-C8), and the only persisted values
   * are the three in `preferences.ts`. The multi-tab amendment of
   * 2026-08-24 named persisted state about the user's work as touching
   * the no-vault, no-account promise, and a folder being browsed is
   * exactly that kind of state.
   */
  sidebarRootFromClick: string | null = null;

  private _modified = false;
  private modifiedListeners: Array<(modified: boolean) => void> = [];
  /**
   * Session-only spellcheck flag. Defaults to `false` (R-C9) because
   * technical documents are full of identifiers and code blocks that
   * browser spell-checkers underline as misspellings. The user can opt
   * in for the current session via the statusbar toggle; the flag is
   * **not** written to localStorage — every launch starts OFF.
   */
  private _spellcheckEnabled = false;
  private spellcheckListeners: Array<(enabled: boolean) => void> = [];

  /**
   * Result of the most recent context-cluster scan, or `null` if no
   * scan has produced a value for the current document yet (fresh
   * document or detection still in flight). The popover and statusbar
   * indicator both subscribe via `onClusterChange`.
   */
  private _cluster: ContextCluster | null = null;
  private clusterListeners: Array<(cluster: ContextCluster | null) => void> = [];

  /**
   * The document's raw metadata block, or `null` when it has none.
   *
   * **An accessor rather than the plain field it used to be** (#196).
   * Four places write it — `applyBundle` on every open, the template
   * seed, `resetDocument`, and the panel's own textarea — and the
   * «Metadata» badge has to be right after every one of them. A plain
   * field left that to each writer remembering to refresh something,
   * which is how the panel's route came to be the one nobody wired: the
   * user emptied the textarea, the block was gone, and anything drawn
   * from it stayed on screen. That is the shape #130 was filed against.
   *
   * Declared exactly like `modified`, `spellcheckEnabled` and `cluster`
   * above, so there is one way to learn that a piece of document state
   * changed rather than four.
   */
  private _frontmatter: string | null = null;
  private frontmatterListeners: Array<(frontmatter: string | null) => void> = [];

  /**
   * Monotonic counter used to discard stale scan results when the user
   * opens documents in rapid succession. Each `applyBundle` increments
   * the counter and only commits the result if its own value still
   * matches by the time `detectContextCluster` resolves. The detector
   * itself is a pure function — coordination lives in state.
   */
  private _clusterScanGeneration = 0;

  get modified(): boolean {
    return this._modified;
  }

  setModified(value: boolean): void {
    this._modified = value;
    for (const cb of this.modifiedListeners) cb(value);
  }

  onModifiedChange(cb: (modified: boolean) => void): void {
    this.modifiedListeners.push(cb);
  }

  get spellcheckEnabled(): boolean {
    return this._spellcheckEnabled;
  }

  setSpellcheck(value: boolean): void {
    if (this._spellcheckEnabled === value) return;
    this._spellcheckEnabled = value;
    for (const cb of this.spellcheckListeners) cb(value);
  }

  onSpellcheckChange(cb: (enabled: boolean) => void): void {
    this.spellcheckListeners.push(cb);
  }

  get cluster(): ContextCluster | null {
    return this._cluster;
  }

  setCluster(value: ContextCluster | null): void {
    this._cluster = value;
    for (const cb of this.clusterListeners) cb(value);
  }

  onClusterChange(cb: (cluster: ContextCluster | null) => void): void {
    this.clusterListeners.push(cb);
  }

  get frontmatter(): string | null {
    return this._frontmatter;
  }

  set frontmatter(value: string | null) {
    // Unconditional, like `setModified` and unlike `setSpellcheck`: the
    // panel writes the textarea's value on every keystroke, and a
    // listener that redraws from the same value is cheaper than the
    // string comparison that would suppress it. What must not happen is
    // a write that notifies nobody.
    this._frontmatter = value;
    for (const cb of this.frontmatterListeners) cb(value);
  }

  onFrontmatterChange(cb: (frontmatter: string | null) => void): void {
    this.frontmatterListeners.push(cb);
  }

  /**
   * Reserve the next scan generation. Callers stash the returned value
   * and check it against `clusterScanGeneration` after their async
   * detector resolves; if it no longer matches, a newer scan has
   * superseded this one and the stale result must be dropped.
   */
  beginClusterScan(): number {
    this._clusterScanGeneration += 1;
    return this._clusterScanGeneration;
  }

  get clusterScanGeneration(): number {
    return this._clusterScanGeneration;
  }

  /**
   * Reset per-document state.
   *
   * `assetsDirConfirmedFor` is **not** among these, on purpose (#51):
   * the agreement is the folder's, not the document's, so a new
   * document whose destination lands in an agreed folder inserts
   * without asking again. See the field's own comment, and R-C5.
   */
  resetDocument(): void {
    this.filePath = null;
    this.frontmatter = null;
    this.isFirstSave = true;
    this.knownDiskText = null;
    this.byteOrderMark = false;
    this.lineConventions = DEFAULT_LINE_CONVENTIONS;
    this.destinationCueShown = false;
    // There is no document, so there is no panel and no root it kept.
    // New, New from Template and Close all reach this through
    // `clearDocumentForReplacement`, and each hides the panel a line
    // later — clearing here is what stops the next document opened from
    // File then Open inheriting a folder from the one before it.
    this.sidebarRootFromClick = null;
    // Bumping the generation invalidates any in-flight detector so the
    // next document doesn't briefly inherit the previous cluster.
    this._clusterScanGeneration += 1;
    this.setCluster(null);
  }
}
