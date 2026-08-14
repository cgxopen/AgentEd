import type { DocumentImage } from '../formats/types';

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
