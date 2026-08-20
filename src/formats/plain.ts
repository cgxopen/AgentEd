import { dirname, joinPath } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { assembleMarkdown, splitFrontmatter } from './frontmatter';
import type { DocumentBundle } from './types';

export interface LoadResult {
  readonly bundle: DocumentBundle;
  /**
   * Exactly the text that was on disk, before any splitting — the
   * baseline the save flow compares against (R-C14). It is reported
   * rather than re-derived because splitting and reassembling is not a
   * byte-exact round trip for every file (a CRLF document with
   * frontmatter comes back with LF fences), and a baseline that differs
   * from the file by one byte would accuse the user on their next save.
   */
  readonly diskText: string;
}

export async function loadMarkdown(path: string, io: PlatformIO): Promise<LoadResult> {
  const text = await io.readText(path);
  const { raw, body } = splitFrontmatter(text);
  return {
    bundle: {
      frontmatterRaw: raw,
      markdownBody: body,
      images: [],
      rootPath: path,
    },
    diskText: text,
  };
}

export interface SaveResult {
  /**
   * Why the images could not be written, or `null` when there was
   * nothing to write or everything was written. The `.md` itself is on
   * disk either way — a failure here never means the document was lost.
   */
  readonly assetsError: unknown;
  /**
   * Exactly the text that was written to `rootPath`. The caller records
   * it as the new baseline for the external-change check (R-C14), so
   * that what AgentEd believes is on disk is what it put there, rather
   * than something assembled a second time.
   */
  readonly writtenText: string;
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
  const writtenText = assembleMarkdown(bundle);
  await io.saveFile(bundle.rootPath, writtenText);

  if (!io.supportsMultiFile) return { assetsError: null, writtenText };

  const assetImages = bundle.images.filter((img) => img.relativePath.startsWith('assets/'));
  if (assetImages.length === 0) return { assetsError: null, writtenText };

  const parent = dirname(bundle.rootPath);
  if (parent.length === 0) return { assetsError: null, writtenText };

  try {
    await io.mkdir(joinPath(parent, 'assets'));
    await Promise.all(
      assetImages.map((img) => io.writeBinary(joinPath(parent, img.relativePath), img.data)),
    );
  } catch (e) {
    return { assetsError: e, writtenText };
  }
  return { assetsError: null, writtenText };
}
