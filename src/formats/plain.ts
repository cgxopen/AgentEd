import { dirname, joinPath } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { applyByteOrderMark, hasByteOrderMark, stripByteOrderMark } from './byte-order-mark';
import { assembleMarkdown, splitFrontmatter } from './frontmatter';
import { applyLineConventions, detectLineConventions } from './line-conventions';
import type { MarkdownDocument } from './types';

export interface LoadResult {
  readonly document: MarkdownDocument;
  /**
   * Exactly the text that was on disk, before any splitting — the
   * baseline the save flow compares against (R-C14). It is reported
   * rather than re-derived because splitting, editing and reassembling
   * is not a byte-exact round trip for every file — R-C2 has its
   * recorded exceptions — and a baseline that differs from the file by
   * one byte would accuse the user on their next save. (Line endings
   * and the final newline used to be such a difference for every CRLF
   * document; since #79 they are re-applied on save, but the reason
   * this is reported rather than re-derived is unchanged.)
   */
  readonly diskText: string;
}

export async function loadMarkdown(path: string, io: PlatformIO): Promise<LoadResult> {
  return parseMarkdown(await io.readText(path), path);
}

/**
 * The same `LoadResult`, from text that has already been read (#141).
 *
 * `loadMarkdown` is one read followed by this split, and the split is
 * pure. It is separate so a caller that was *handed* the file's text —
 * `openFile` reads it from the picked handle before it answers — can
 * build the document from that text instead of asking the platform to
 * find the file a second time by name. On the web that second lookup is
 * what went wrong; on the desktop it is one read of a file already in
 * memory.
 *
 * `diskText` means the same thing either way: exactly the text that was
 * on disk, and therefore the R-C14 baseline.
 */
export function parseMarkdown(text: string, path: string): LoadResult {
  // The mark comes off first and is remembered, because everything
  // below reads the start of the text: a mark in front of `---` is a
  // metadata block `splitFrontmatter` would not recognise (#259).
  const mark = hasByteOrderMark(text);
  const withoutMark = stripByteOrderMark(text);
  const { raw, body } = splitFrontmatter(withoutMark);
  return {
    document: {
      byteOrderMark: mark,
      frontmatterRaw: raw,
      markdownBody: body,
      images: [],
      rootPath: path,
      // Read from the text before any splitting — the same text the
      // R-C14 baseline is taken from, and for the same reason: this is
      // what the file actually contains (#79).
      lineConventions: detectLineConventions(withoutMark),
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
export async function saveMarkdown(
  document: MarkdownDocument,
  io: PlatformIO,
): Promise<SaveResult> {
  // The document's own line conventions are re-applied here, to the
  // whole assembled text and nowhere else (#79): the serializer emits
  // `\n` and no final newline, and this is the point where the text
  // that will be written exists in one piece.
  // The mark goes back on last, outside the line conventions: it stands
  // in front of the first line rather than being part of one (#259).
  const writtenText = applyByteOrderMark(
    applyLineConventions(assembleMarkdown(document), document.lineConventions),
    document.byteOrderMark,
  );
  await io.saveFile(document.rootPath, writtenText);

  const assetImages = document.images.filter((img) => img.relativePath.startsWith('assets/'));
  if (assetImages.length === 0) return { assetsError: null, writtenText };

  // **No silent drop** (#46). This used to return `assetsError: null`
  // whenever the document's path carried no directory — reporting a
  // complete save over images that never reached the disk, which is the
  // one thing R-C5 says must not happen: if the folder cannot be made,
  // the document is still saved *and the failure is reported*.
  //
  // It was unreachable while it stood, because every web insert died
  // earlier and every desktop path carries a directory. Offering the
  // destination step on web is what would have made it live, so it is
  // closed in the same change rather than left as a trap that this one
  // arms.
  //
  // The platform answers, for the same reason it answers in
  // `resolveAssetsDir`: a bare name is malformed on desktop and ordinary
  // on web, and only the platform knows which it is holding.
  if (!(await io.canWriteCompanions(document.rootPath))) {
    return {
      assetsError: new Error('This document has nowhere to put its images.'),
      writtenText,
    };
  }

  // Empty for a web document, whose `assets/` is resolved against the
  // granted directory handle; `joinPath` drops the empty segment.
  const parent = dirname(document.rootPath);

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
