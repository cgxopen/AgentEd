import type { PlatformIO } from '../platform/types';
import { loadMarkdown, type SaveResult, saveMarkdown } from './plain';
import type { DocumentBundle } from './types';

export { assembleMarkdown, splitFrontmatter } from './frontmatter';
export type { SaveResult } from './plain';
export type { DocumentBundle, DocumentImage } from './types';

/**
 * Load a markdown document from disk. Every document is a plain `.md`
 * file — the single format the editor reads and writes.
 */
export async function loadDocument(path: string, io: PlatformIO): Promise<DocumentBundle> {
  return loadMarkdown(path, io);
}

export async function saveDocument(bundle: DocumentBundle, io: PlatformIO): Promise<SaveResult> {
  return saveMarkdown(bundle, io);
}
