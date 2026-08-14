import type { PlatformIO } from '../platform/types';
import { detectDocumentShape } from './detect';
import { loadMarkdown, saveMarkdown } from './plain';
import { loadStructured, saveStructured } from './structured';
import type { DocumentBundle } from './types';

export { IMAGE_EXTENSIONS, isImagePath, rewriteAttachmentsPathsInBody } from './assets';
export { detectDocumentShape } from './detect';
export { assembleMarkdown, ensureFrontmatterForProfile, splitFrontmatter } from './frontmatter';
export { createMeta } from './meta';
export type {
  AgentedMeta,
  ArchiveEntry,
  DocumentBundle,
  DocumentImage,
  StructuredLayout,
} from './types';

/**
 * Dispatch on the detected document shape: structured documents (with a
 * companion folder) load through `loadStructured`, plain markdown
 * single-files through `loadMarkdown`.
 */
export async function loadDocument(path: string, io: PlatformIO): Promise<DocumentBundle> {
  const shape = await detectDocumentShape(path, io);
  if (shape.docFolder && shape.layout) {
    return loadStructured(path, shape.docFolder, shape.layout, io);
  }
  return loadMarkdown(path, io);
}

export async function saveDocument(bundle: DocumentBundle, io: PlatformIO): Promise<void> {
  if (bundle.docFolder) return saveStructured(bundle, io);
  return saveMarkdown(bundle, io);
}
