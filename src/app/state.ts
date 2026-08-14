import type { ContextCluster } from '../cluster/types';
import type { ArchiveEntry, DocumentBundle, StructuredLayout } from '../formats/types';
import type { ProfileId } from '../profiles/types';

/**
 * Central mutable state for the app. All handlers read/write through a
 * single AppState instance so extracted modules can share it without
 * reaching for module-level `let` bindings in main.ts.
 *
 * `modified` is the only field with a subscription API because it is the
 * only flag that drives DOM (modified indicator + Close button enable).
 *
 * After ADR-030, `profile` is the primary axis: validation rules,
 * frontmatter rules, and image-paste capability all derive from it.
 * Document layout (`docFolder` + `layout`) is the only persistence
 * shape — there's no longer a separate Mode field.
 */
export class AppState {
  filePath: string | null = null;
  meta: DocumentBundle['meta'] = null;
  frontmatter: string | null = null;
  archiveEntries: ArchiveEntry[] = [];
  isFirstSave = true;
  isSaving = false;
  /** Active profile (auto-detected on load, or set via statusbar override). */
  profile: ProfileId = 'plain';
  /**
   * True when the user explicitly overrode auto-detection via the
   * statusbar dropdown for the current document. Cleared on Close /
   * New / open of another document.
   */
  profileOverridden = false;
  /**
   * Sticky for the current document session: once the user cancels the
   * "Create assets/?" dialog on first image paste, subsequent pastes in
   * this session won't reopen it. Cleared on Close / New / open.
   */
  assetsDirCreationDeclined = false;
  docFolder: string | null = null;
  layout: StructuredLayout | null = null;

  private _modified = false;
  private modifiedListeners: Array<(modified: boolean) => void> = [];
  /**
   * Session-only spellcheck flag. Defaults to `false` because agent
   * documents are full of technical identifiers (`metadata.openclaw`,
   * skill keys, code blocks) that browser spell-checkers underline as
   * misspellings. The user can opt in for the current session via the
   * statusbar toggle. Per ADR-030 minimal-persistence principle, the
   * flag is **not** written to localStorage — every launch starts OFF.
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

  /** Reset per-document state. Profile collapses back to `plain`. */
  resetDocument(): void {
    this.filePath = null;
    this.meta = null;
    this.frontmatter = null;
    this.archiveEntries = [];
    this.isFirstSave = true;
    this.profile = 'plain';
    this.profileOverridden = false;
    this.assetsDirCreationDeclined = false;
    this.docFolder = null;
    this.layout = null;
    // Bumping the generation invalidates any in-flight detector so the
    // next document doesn't briefly inherit the previous cluster.
    this._clusterScanGeneration += 1;
    this.setCluster(null);
  }
}
