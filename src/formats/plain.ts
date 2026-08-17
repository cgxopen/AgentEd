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
    rootPath: path,
  };
}

export interface SaveResult {
  /**
   * Why the images could not be written, or `null` when there was
   * nothing to write or everything was written. The `.md` itself is on
   * disk either way — a failure here never means the document was lost.
   */
  readonly assetsError: unknown | null;
}

/**
 * Save a plain markdown document. Writes the .md file, plus any
 * `assets/`-prefixed images registered against the document — those
 * land in `<dirname(rootPath)>/assets/`, and this is the only place the
 * folder is created (#14). Other registered images are ignored to avoid
 * scribbling on user-managed paths.
 *
 * The two phases fail differently, on purpose. A failure to write the
 * `.md` throws: the save did not happen and the caller must treat the
 * document as unsaved. A failure to write the images does **not** throw,
 * because by then the document is already on disk and AgentEd neither
 * un-writes nor deletes files; the caller is handed the error to show and
 * the bytes stay in the in-memory registry, so the next save retries.
 * The document's text is the part that cannot be reconstructed, so it is
 * written first and never rolled back for the sake of its images.
 */
export async function saveMarkdown(bundle: DocumentBundle, io: PlatformIO): Promise<SaveResult> {
  await io.saveFile(bundle.rootPath, assembleMarkdown(bundle));

  if (!io.supportsMultiFile) return { assetsError: null };

  const assetImages = bundle.images.filter((img) => img.relativePath.startsWith('assets/'));
  if (assetImages.length === 0) return { assetsError: null };

  const parent = dirname(bundle.rootPath);
  if (parent.length === 0) return { assetsError: null };

  try {
    await io.mkdir(joinPath(parent, 'assets'));
    await Promise.all(
      assetImages.map((img) => io.writeBinary(joinPath(parent, img.relativePath), img.data)),
    );
  } catch (e) {
    return { assetsError: e };
  }
  return { assetsError: null };
}
