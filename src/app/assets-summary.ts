import type { Editor } from '@tiptap/core';
import { getRelativePath } from '../editor/image-registry';
import { collapseDotSegments, dirname, joinPath, normalize, pathKey } from '../platform/paths';
import type { PlatformIO } from '../platform/types';

/**
 * What the «Images» popover of R-C12 says, gathered on click.
 *
 * *"3 images used by this document · assets/ holds 9 more files"* — two
 * numbers, and only the first is free. The second is a directory
 * listing, which is why it is not computed with the badge: the badge
 * needs a boolean and rides on every keystroke, this runs once, when the
 * user asks. R-C12 calls that *information on demand*.
 */

/** What could be established about the `assets/` folder beside the document. */
export type AssetsFolder =
  /** The folder was listed. `otherFiles` excludes the ones this document uses. */
  | { readonly kind: 'counted'; readonly otherFiles: number }
  /** There is no `assets/` folder next to this document. */
  | { readonly kind: 'absent' }
  /**
   * Nothing could be established — the folder is there and shut (#58),
   * or the browser session holds no grant for it (#184, #188).
   *
   * **The third state is inherited, not invented.** `entryPresence`
   * already answers `present` / `absent` / `unknown` and never rejects
   * (#126), and this is the same `unknown`. It exists because the
   * alternative is the confident wrong answer: `WebIO.listDir` returns
   * `[]` with no grant — *"no folder has been granted, so there is no
   * folder to be wrong about"* — and a popover that called it directly
   * would report an empty `assets/` to a user who simply has not granted
   * one. That is the #58 mistake with a different folder.
   */
  | { readonly kind: 'unknown' }
  /**
   * The document has never been saved, so there is no folder to look in
   * yet. Not a failure: R-C5 creates `assets/` at save time and not
   * before (#14), and the header already says the document and its
   * images are waiting for one (#48).
   */
  | { readonly kind: 'unsaved' };

export interface AssetsSummary {
  /** Distinct images this document uses. */
  readonly imagesInDocument: number;
  readonly folder: AssetsFolder;
}

/**
 * The distinct images this document references, by the name each one has
 * on disk where that is known.
 *
 * **Distinct, not one per node**: the same picture placed twice is one
 * image used twice, and R-C12 asks how many images the document *uses*.
 *
 * `getRelativePath` is consulted first because by the time a document is
 * on screen its `src` is a blob URL — `prepareMarkdownForDisplay`
 * rewrites every reference it could resolve — and the registry is what
 * maps that blob back to `assets/x.png`. A reference the loader could
 * not resolve keeps its original `src`, and that is what is counted,
 * which is the same rule the badge follows: what the document
 * references, not what resolved.
 */
function imagesUsed(editor: Editor): Set<string> {
  const used = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'image') return true;
    const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
    if (src === '') return true;
    used.add(getRelativePath(src) ?? src);
    return true;
  });
  return used;
}

/** A URL of any scheme. A drive letter is a path, and is not one. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DRIVE = /^[a-z]:\//i;

/**
 * Where an image reference points, as a path the platform would give the
 * file, or `null` for a URL, which is no file beside the document.
 *
 * Read against the folder of the document, with its percent-encoding taken
 * off, since a reference spells a space `%20` where the disk has a space,
 * and with `./` and `..` collapsed.
 */
function fileOfReference(reference: string, documentFolder: string): string | null {
  const slashed = normalize(reference);
  if (SCHEME.test(slashed) && !DRIVE.test(slashed)) return null;
  let decoded = slashed;
  try {
    decoded = decodeURI(slashed);
  } catch {
    // A stray `%` is the name's own character, so the reference is read as written.
  }
  const absolute =
    decoded.startsWith('/') || DRIVE.test(decoded) ? decoded : joinPath(documentFolder, decoded);
  return collapseDotSegments(absolute);
}

/**
 * **The one answer to which files in `assets/` this document leaves unused**
 * (#380), read by the popover count of R-C12 and by the grey mark of R-C6,
 * so the two cannot disagree.
 *
 * A file is unused when it sits directly in the `assets/` folder beside the
 * document and no image of the document names it. Until #380 the popover
 * compared names alone, which read `other/e.png` and a web address ending
 * in `f.png` as using `assets/e.png` and `assets/f.png`, and read a used
 * `my pic.png`, referenced as `my%20pic.png`, and a used `g.png`, referenced
 * as `Assets/G.PNG` on Windows, as unused. Paths are now compared whole, by
 * the rule `samePath` states.
 *
 * **A document never saved leaves nothing unused**: it has no folder, so
 * whether a file beside it is used cannot be established, and that is never
 * reported as unused.
 */
export function unusedAssetFiles(
  editor: Editor,
  filePath: string | null,
): (path: string) => boolean {
  if (filePath === null) return () => false;
  const folder = dirname(filePath);
  const assetsDir = pathKey(joinPath(folder, 'assets'));
  // Keys rather than paths, so a folder of many files costs one lookup each.
  const referenced = new Set<string>();
  for (const reference of imagesUsed(editor)) {
    const file = fileOfReference(reference, folder);
    if (file !== null) referenced.add(pathKey(file));
  }
  return (path) => pathKey(dirname(path)) === assetsDir && !referenced.has(pathKey(path));
}

/**
 * Count the files in `dir` that this document does not use, by the answer
 * above. Directories are not files and are not counted; R-C12 says *how
 * many other files the folder holds*.
 */
function countOtherFiles(
  dir: string,
  entries: ReadonlyArray<{ name: string; isDirectory: boolean }>,
  unused: (path: string) => boolean,
): number {
  return entries.filter((entry) => !entry.isDirectory && unused(joinPath(dir, entry.name))).length;
}

/**
 * Gather what the popover needs.
 *
 * **`canWriteCompanions` is deliberately not on this path.** It is the
 * question *may a companion be written beside this document*, which is
 * `resolveAssetsDir`'s first line and the reason every route to the
 * `assets/` path today goes through it. This route only reads, and
 * `entryPresence` answers the question a read actually has — is the
 * folder there — for both platforms, without rejecting (#126). Routing
 * through the write predicate instead would have made it a fourth
 * consumer with a fourth meaning, which is #201, and it would have
 * turned *no grant yet* into *no folder*, losing the one state this
 * popover most needs to keep.
 */
export async function summariseAssets(
  editor: Editor,
  filePath: string | null,
  io: PlatformIO,
): Promise<AssetsSummary> {
  const imagesInDocument = imagesUsed(editor).size;

  if (filePath === null) return { imagesInDocument, folder: { kind: 'unsaved' } };

  const dir = joinPath(dirname(filePath), 'assets');

  const presence = await io.entryPresence(dir);
  if (presence === 'absent') return { imagesInDocument, folder: { kind: 'absent' } };
  if (presence === 'unknown') return { imagesInDocument, folder: { kind: 'unknown' } };

  try {
    const entries = await io.listDir(dir);
    return {
      imagesInDocument,
      folder: {
        kind: 'counted',
        otherFiles: countOtherFiles(dir, entries, unusedAssetFiles(editor, filePath)),
      },
    };
  } catch (e) {
    // A folder that is there and cannot be read is not an empty folder
    // (#58). `TauriIO.listDir` raises rather than answering, and the
    // honest report of that is the same `unknown` a shut folder gets
    // from `entryPresence` — never zero.
    console.warn('[agented] could not list the assets folder:', dir, e);
    return { imagesInDocument, folder: { kind: 'unknown' } };
  }
}

/** The sentence the popover shows, as one string. Pinned by its tests. */
export function describeAssets(summary: AssetsSummary): string {
  const { imagesInDocument, folder } = summary;
  const images = `${imagesInDocument} image${imagesInDocument === 1 ? '' : 's'} used by this document`;

  switch (folder.kind) {
    case 'counted':
      return folder.otherFiles === 0
        ? `${images} · assets/ holds nothing else`
        : `${images} · assets/ holds ${folder.otherFiles} more file${folder.otherFiles === 1 ? '' : 's'}`;
    case 'absent':
      return `${images} · there is no assets/ folder next to it`;
    case 'unknown':
      // Claims neither present nor absent, because neither was
      // established. The two ways to get here read differently to the
      // user — a folder the system would not open, and a browser session
      // that has not been given the folder — and this sentence is true
      // of both without naming a cause it does not know.
      return `${images} · assets/ could not be checked from here`;
    case 'unsaved':
      return `${images} · assets/ arrives when you save this document`;
  }
}
