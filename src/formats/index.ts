import type { PlatformIO } from '../platform/types';
import { type LoadResult, loadMarkdown, type SaveResult, saveMarkdown } from './plain';
import type { DocumentBundle } from './types';

export { detectExternalChange, type ExternalChange } from './external-change';
export { assembleMarkdown, splitFrontmatter } from './frontmatter';
export type { LoadResult, SaveResult } from './plain';
export type { DocumentBundle, DocumentImage } from './types';

/**
 * Load a markdown document from disk. Every document is a plain `.md`
 * file — the single format the editor reads and writes. The text that
 * was on disk comes back alongside the parsed bundle: it is the
 * baseline for the external-change check (R-C14).
 */
export async function loadDocument(path: string, io: PlatformIO): Promise<LoadResult> {
  return loadMarkdown(path, io);
}

export async function saveDocument(bundle: DocumentBundle, io: PlatformIO): Promise<SaveResult> {
  return saveMarkdown(bundle, io);
}
