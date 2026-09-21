import type { PlatformIO } from '../platform/types';
import {
  type LoadResult,
  loadMarkdown,
  parseMarkdown,
  type SaveResult,
  saveMarkdown,
} from './plain';
import type { MarkdownDocument } from './types';

export {
  applyByteOrderMark,
  hasByteOrderMark,
  stripByteOrderMark,
} from './byte-order-mark';
export { detectExternalChange, type ExternalChange } from './external-change';
export { assembleMarkdown, splitFrontmatter } from './frontmatter';
export {
  applyLineConventions,
  DEFAULT_LINE_CONVENTIONS,
  detectLineConventions,
  type LineConventions,
} from './line-conventions';
export type { LoadResult, SaveResult } from './plain';
export type { DocumentImage, MarkdownDocument } from './types';

/**
 * Load a markdown document from disk. Every document is a plain `.md`
 * file — the single format the editor reads and writes. The text that
 * was on disk comes back alongside the parsed document: it is the
 * baseline for the external-change check (R-C14).
 */
export async function loadDocument(path: string, io: PlatformIO): Promise<LoadResult> {
  return loadMarkdown(path, io);
}

/**
 * The same result, for a caller that already holds the file's text —
 * `openFile` hands back what it read from the picked handle (#141). No
 * read happens here.
 */
export function parseDocument(text: string, path: string): LoadResult {
  return parseMarkdown(text, path);
}

export async function saveDocument(
  document: MarkdownDocument,
  io: PlatformIO,
): Promise<SaveResult> {
  return saveMarkdown(document, io);
}
