import { dirname, joinPath } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { assembleMarkdown, splitFrontmatter } from './frontmatter';
import type { DocumentBundle } from './types';

export async function loadMarkdown(path: string, io: PlatformIO): Promise<DocumentBundle> {
  const text = await io.readText(path);
  const { raw, body } = splitFrontmatter(text);
  return {
    frontmatterRaw: raw,
    markdownBody: body,
    images: [],
    archiveEntries: [],
    rootPath: path,
    meta: null,
    docFolder: null,
    layout: null,
  };
}

/**
 * Save a plain markdown document. Writes the .md file, plus any
 * `assets/`-prefixed images registered against the document — those
 * land in `<dirname(rootPath)>/assets/` (idempotent mkdir, idempotent
 * writes for unchanged content). Other registered images are ignored
 * to avoid scribbling on user-managed paths.
 */
export async function saveMarkdown(bundle: DocumentBundle, io: PlatformIO): Promise<void> {
  await io.saveFile(bundle.rootPath, assembleMarkdown(bundle));

  if (!io.supportsMultiFile) return;

  const assetImages = bundle.images.filter((img) => img.relativePath.startsWith('assets/'));
  if (assetImages.length === 0) return;

  const parent = dirname(bundle.rootPath);
  if (parent.length === 0) return;

  await io.mkdir(joinPath(parent, 'assets'));
  await Promise.all(
    assetImages.map((img) => io.writeBinary(joinPath(parent, img.relativePath), img.data)),
  );
}
