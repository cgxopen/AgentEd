/**
 * Where a structured document's companion folder lives on disk.
 *
 *  - `sibling`: native AgentEd layout — `doc.md` + `doc/assets/` + `doc/.agented-meta.json`.
 *  - `parent-as-folder`: ecosystem layout — `parent/SKILL.md` with companion folders
 *    (`scripts/`, `references/`, `agents/`, `assets/`) living directly under `parent/`.
 *
 * Layout is a load-time property of the document; markdown documents
 * have `layout = null` and `docFolder = null`.
 */
export type StructuredLayout = 'sibling' | 'parent-as-folder';

export interface DocumentImage {
  relativePath: string;
  data: Uint8Array;
  filename: string;
}

export interface ArchiveEntry {
  path: string;
  kind: 'file' | 'directory';
  data?: Uint8Array;
}

export interface AgentedMeta {
  agented_version: string;
  format: 'structured';
  created_at: string;
  modified_at: string;
  content_hash: string;
  attachments_count: number;
  /** @deprecated Will be reintroduced in Pro. Kept for backward compat. */
  embeddings_status: 'none' | 'current' | 'outdated';
}

export interface DocumentBundle {
  /** Raw frontmatter YAML (null if no frontmatter) */
  frontmatterRaw: string | null;
  /** Markdown body without frontmatter */
  markdownBody: string;
  /** All images in the document */
  images: DocumentImage[];
  /** Non-image companion files preserved across save (scripts/, references/, …) */
  archiveEntries: ArchiveEntry[];
  /** Root path on disk */
  rootPath: string;
  /** Metadata (null when no companion folder) */
  meta: AgentedMeta | null;
  /**
   * Canonical path to the companion folder for structured documents.
   * Null for plain markdown (single file with no companion structure).
   * Resolved at load time from the detected layout.
   */
  docFolder: string | null;
  /** Layout discovered at load. Null when there's no companion folder. */
  layout: StructuredLayout | null;
}
