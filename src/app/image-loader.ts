import { registerImage } from '../editor/image-registry';
import type { DocumentBundle } from '../formats/types';
import { isTauri } from '../platform/detect';
import { dirname, joinPath } from '../platform/paths';
import type { PlatformIO } from '../platform/types';

const MAX_IMAGES = 200;
const ABS_URL_RE = /^(https?:|blob:|data:|http:\/\/asset\.)/;
const MD_IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const HTML_IMG_RE = /<img\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
const HTML_IMG_REPLACE_RE = /(<img\s+[^>]*src\s*=\s*["'])([^"']+)(["'][^>]*>)/gi;

/**
 * Resolve image references in a bundle's markdown body to displayable URLs:
 * read the referenced images from disk relative to the document path,
 * create blob URLs, and register them. Handles `![]()` and `<img>` syntax.
 *
 * Missing files are tolerated — the original src is left in place and a warn
 * is logged. Capped at MAX_IMAGES per syntax to defend against pathological docs.
 */
export async function prepareMarkdownForDisplay(
  bundle: DocumentBundle,
  io: PlatformIO,
): Promise<string> {
  return resolveFilesystemImages(bundle.markdownBody, bundle.rootPath, io);
}

async function resolveFilesystemImages(
  md: string,
  docPath: string,
  io: PlatformIO,
): Promise<string> {
  if (!md || !isTauri) return md;
  const docDir = dirname(docPath);
  if (!docDir) return md;

  const urlCache = new Map<string, string>();

  async function resolveOne(src: string): Promise<string> {
    if (ABS_URL_RE.test(src)) return src;
    const cached = urlCache.get(src);
    if (cached) return cached;
    const abs = joinPath(docDir, src);
    try {
      const data = await io.readBinary(abs);
      const blob = new Blob([data.slice().buffer as ArrayBuffer]);
      const url = URL.createObjectURL(blob);
      const filename = src.split('/').pop() || src;
      registerImage(url, { relativePath: src, data, filename });
      urlCache.set(src, url);
      return url;
    } catch (e) {
      console.warn(`[image-loader] could not read ${abs}:`, e);
      return src;
    }
  }

  const mdMatches = Array.from(md.matchAll(MD_IMG_RE)).slice(0, MAX_IMAGES);
  const htmlMatches = Array.from(md.matchAll(HTML_IMG_RE)).slice(0, MAX_IMAGES);

  const replacements = new Map<string, string>();
  await Promise.all([
    ...mdMatches.map(async (m) => {
      replacements.set(m[2], await resolveOne(m[2]));
    }),
    ...htmlMatches.map(async (m) => {
      replacements.set(m[1], await resolveOne(m[1]));
    }),
  ]);

  let out = md.replace(MD_IMG_RE, (_match, alt, src) => {
    const url = replacements.get(src) ?? src;
    return `![${alt}](${url})`;
  });
  out = out.replace(HTML_IMG_REPLACE_RE, (_match, pre, src, post) => {
    const url = replacements.get(src) ?? src;
    return `${pre}${url}${post}`;
  });
  return out;
}
