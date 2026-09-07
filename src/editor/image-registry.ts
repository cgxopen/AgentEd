import type { DocumentImage } from '../formats/types';

/**
 * The media type a display blob is given, chosen from the file name (#248).
 *
 * **Why a blob needs one at all.** A display url points at bytes with no
 * name, so the only thing that tells the browser what it is holding is the
 * type on the blob. For png, jpeg, gif and webp it sniffs the bytes and gets
 * there anyway, which is why every image but one has always displayed with no
 * type at all. **It never sniffs svg** - an `img` pointed at a typeless blob
 * of svg bytes draws nothing, which is the placeholder #248 was opened for.
 *
 * **An unlisted extension is answered with the empty string on purpose**, and
 * that is what the two call sites pass to `new Blob`, so its behaviour is
 * exactly what it was before this table existed. Answering
 * `application/octet-stream` instead would be worse than saying nothing: a
 * `.bmp` or an `.ico` a document references is sniffed and drawn today, and
 * naming it as a byte stream would stop that. The empty string keeps every
 * such file where it was and moves only the extensions named here.
 *
 * **This is a second table and it is deliberately not the one in
 * `src/app/media-picker.ts`.** The names overlap; the functions do not. That
 * one types a `File` on the way *in*, where an unknown extension has to be
 * called something and `application/octet-stream` is the honest answer. This
 * one types a blob on the way *out*, where an unknown extension has to be
 * called nothing at all or a file that displays today stops displaying. Same
 * six names, opposite fallbacks, and merging them would mean one of the two
 * callers getting the wrong one.
 */
const DISPLAY_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * The media type for `filename`, or the empty string when it is not one of
 * the six above. Takes a file name rather than an extension so that a caller
 * holding a name, a relative path or an absolute one can pass what it has.
 */
export function displayMimeFromName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return '';
  return DISPLAY_MIME_BY_EXT[filename.slice(dot + 1).toLowerCase()] ?? '';
}

const registry = new Map<string, DocumentImage>();
const displayUrls = new Map<string, string>();

export function registerImage(displayUrl: string, image: DocumentImage): void {
  registry.set(displayUrl, image);
  displayUrls.set(image.relativePath, displayUrl);
}

export function getImageByUrl(displayUrl: string): DocumentImage | undefined {
  return registry.get(displayUrl);
}

export function getDisplayUrl(relativePath: string): string | undefined {
  return displayUrls.get(relativePath);
}

/** Reverse lookup: display URL → relative path (O(1) via reverse map) */
export function getRelativePath(displayUrl: string): string | undefined {
  return registry.get(displayUrl)?.relativePath;
}

export function getAllImages(): DocumentImage[] {
  return Array.from(registry.values());
}

export function clearImages(): void {
  for (const url of registry.keys()) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
  registry.clear();
  displayUrls.clear();
}

/** Create a blob URL for display and register image binary data */
export async function registerBlob(file: File, relativePath: string): Promise<string> {
  const buf = await file.arrayBuffer();
  const url = URL.createObjectURL(file);
  registerImage(url, {
    relativePath,
    data: new Uint8Array(buf),
    filename: file.name,
  });
  return url;
}

/** Register image from binary data. Uses blob URLs universally (both Tauri and Web). */
export function registerForDisplay(
  relativePath: string,
  data: Uint8Array,
  filename: string,
  _docDir: string, // kept for signature compatibility
): string {
  const displayUrl = URL.createObjectURL(new Blob([data.slice().buffer as ArrayBuffer]));
  registerImage(displayUrl, { relativePath, data, filename });
  return displayUrl;
}
