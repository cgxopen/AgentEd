import type { ContextCluster } from '../cluster/types';

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
  frontmatter: string | null = null;
  isFirstSave = true;
  isSaving = false;
  /**
   * The user's answer to the "Create assets/?" dialog, remembered per
   * folder rather than per session, and asked once (#14, #45).
   *
   * Keyed by directory because the folder is no longer created at the
   * moment it is agreed to: without the creation to make the second
   * insert find `exists: true`, a boolean would re-open the dialog for
   * every image pasted before the first save. Keying on the path also
   * gives the honest answer after a Save As into a different folder —
   * that is a different folder to consent to, so it is asked about.
   *
   * Both are cleared on Close / New / open.
   */
  assetsDirConfirmedFor: string | null = null;
  assetsDirDeclinedFor: string | null = null;

  /**
   * Whether this document has already been told that naming a
   * destination is not a save (#48). The cue explains the silence that
   * follows the first insert into a document with no file on disk;
   * repeating it for every pasted image would be noise, so it is shown
   * once per document and cleared in `resetDocument()` alongside the
   * assets/ answers, which it belongs with.
   */
  destinationCueShown = false;

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

  /** Reset per-document state. */
  resetDocument(): void {
    this.filePath = null;
    this.frontmatter = null;
    this.isFirstSave = true;
    this.assetsDirConfirmedFor = null;
    this.assetsDirDeclinedFor = null;
    this.destinationCueShown = false;
    // Bumping the generation invalidates any in-flight detector so the
    // next document doesn't briefly inherit the previous cluster.
    this._clusterScanGeneration += 1;
    this.setCluster(null);
  }
}
