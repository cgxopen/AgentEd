/**
 * Public types for the Context Cluster subsystem (ADR-031).
 *
 * The cluster is an orthogonal subsystem from the Profile Registry — it
 * scans the filesystem tree around an open document and returns a list
 * of related context files (AGENTS.md, CLAUDE.md, .cursorrules, etc.).
 *
 * Detection is a pure function over `PlatformIO`; profile mapping for
 * popover chips happens later in the UI layer (`src/ui/cluster-popover`).
 */

/**
 * Canonical kind for a discovered context file. Drives the chip label
 * and icon in the popover; profile mapping is decoupled.
 */
export type ContextFileKind =
  | 'agents-md'
  | 'claude-md'
  | 'hermes-context'
  | 'cursor-rules'
  | 'hermes-soul';

/**
 * Position of an entry's directory relative to the open document's
 * directory.
 *
 *  - `self`     — same directory as the open document
 *  - `ancestor` — walk-up direction (parent, grandparent, …)
 *  - `sibling`  — same depth as the open document (child of the parent)
 *  - `child`    — one level below the open document
 */
export type ClusterDirection = 'self' | 'ancestor' | 'sibling' | 'child';

export interface ContextFileEntry {
  /** Absolute path to the discovered file (forward-slash). */
  path: string;
  /** File's basename, e.g. `AGENTS.md`. */
  filename: string;
  /** Canonical kind from the registry. */
  kind: ContextFileKind;
  /** Position relative to the open document. */
  direction: ClusterDirection;
  /**
   * Tree-distance from the open document's directory. `0` means the
   * entry lives in the same directory; `1` is parent / sibling /
   * direct child; `2+` is grandparent or deeper.
   */
  distance: number;
  /**
   * Path expressed relative to the open document's directory, e.g.
   * `../AGENTS.md` or `backend/AGENTS.md`. Used for the secondary
   * line in the popover layout.
   */
  relativePath: string;
}

/**
 * Immutable result of a single cluster scan. `currentPath` echoes the
 * file the scan was anchored on; `entries` is sorted by ascending
 * distance.
 */
export class ContextCluster {
  readonly currentPath: string;
  readonly entries: ReadonlyArray<ContextFileEntry>;

  constructor(currentPath: string, entries: ReadonlyArray<ContextFileEntry>) {
    this.currentPath = currentPath;
    this.entries = entries;
  }

  /** Empty cluster sentinel. Used when detection is disabled or yields nothing. */
  static empty(currentPath = ''): ContextCluster {
    return new ContextCluster(currentPath, []);
  }

  /** Number of related entries discovered (excluding the open document itself). */
  get relatedCount(): number {
    return this.entries.length;
  }
}
