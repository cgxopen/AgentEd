import type { DocumentImage } from '../formats/types';

/**
 * Recognising an image the document already has (#52).
 *
 * **Identity is content, never name.** Two files called `diagram.png` from
 * two different folders are two different pictures, and R-C5 keeps them
 * both — the numeric suffix is the only thing standing between the user and
 * losing one of them. Conversely the same screenshot pasted twice arrives as
 * `notes-01.png` and `notes-02.png`: identical bytes under different names,
 * which anything keyed on names misses entirely. Only the bytes decide.
 */

/** Images live in `assets/` next to the document; only those are ours to reuse. */
const ASSETS_PREFIX = 'assets/';

/**
 * Whether two images are the same picture. Length first, so images that
 * cannot match cost a single comparison; the byte loop is bounded by
 * MAX_IMAGE_SIZE, which is what refuses an image before it is ever read.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * The image already registered for this document whose bytes are exactly
 * `data`, or `undefined` when this is a picture the document does not have
 * yet. The scan is bounded by the registry, which the loader caps per
 * document.
 *
 * Restricted to `assets/`: a document may also reference images from paths
 * the user manages (`../shared/logo.png`), and those are read on open but
 * never written by a save. Pointing a new insert at one of them would make
 * AgentEd adopt a file it does not own, which is a different decision from
 * the one this makes.
 */
export function findIdenticalImage(
  data: Uint8Array,
  images: readonly DocumentImage[],
): DocumentImage | undefined {
  for (const image of images) {
    if (!image.relativePath.startsWith(ASSETS_PREFIX)) continue;
    if (bytesEqual(image.data, data)) return image;
  }
  return undefined;
}

/**
 * The entry in `names` that Windows would consider the same file name, or
 * `null` when the name is free. Case-insensitive for the same reason
 * naming is (R-C5): the primary target stores names that way.
 */
export function findNameAmong(name: string, names: ReadonlySet<string>): string | null {
  const lowered = name.toLowerCase();
  for (const entry of names) {
    if (entry.toLowerCase() === lowered) return entry;
  }
  return null;
}
