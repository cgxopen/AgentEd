import { registerImage } from '../editor/image-registry';
import type { DocumentBundle } from '../formats/types';
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
 * is logged. **On both platforms since #187**: the pass used to run on the
 * desktop alone, so a web document showed broken images with nothing said
 * about them. Capped at MAX_IMAGES per syntax to defend against pathological
 * docs: the cap is applied to the match list before anything is resolved, so
 * what it bounds is the disk reads, the blobs and the registry entries. The
 * `matchAll` pass over the document is not capped, and references past the
 * cap are left exactly as they were written.
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
  if (!md) return md;

  // **Can this session reach the files beside the document** (#187).
  //
  // Two locks stood here and they were one defect. The first was
  // `isTauri`, which answers *which platform is this* and was standing
  // in for *can I read the folder* — they coincided while the web build
  // could reach no folder at all, and #188 stopped them coinciding: a
  // web session can now hold a grant, so the capability existed and the
  // flag still said no. The second was `if (!docDir) return md`, which
  // looks like arithmetic and is a policy: on the desktop an empty
  // parent is a malformed path, and on the web it is the root of the
  // granted folder, where both routes to a grant put the document.
  //
  // One question answers both, and it is answered by the layer that
  // owns the capability rather than by the platform's name.
  // `canWriteCompanions` is named for writing and its meaning is the
  // neighbourhood — *can the granted folder hold a companion beside
  // this document* — which is the same thing a read of `assets/` needs,
  // and it already carries the empty-parent policy for each platform:
  // `dirname(path).length > 0` on the desktop, a grant that can name
  // the document on the web. Reusing it is the #188 shape and the
  // comment is what the name does not say.
  //
  // With no grant the answer is `false` and nothing is attempted, which
  // is the state the sidebar's own offer line already speaks for
  // (#184). Owner decision of 2026-08-30: nothing is said here, because
  // the answer is one panel away and a second notice per document is
  // what R-C5 refuses.
  if (!(await io.canWriteCompanions(docPath))) return md;

  // Empty on the web for a document at the root of the grant, and
  // `joinPath` drops the empty segment — so `assets/img.png` resolves
  // against the grant, which is where it is. The check above is what
  // makes an empty value safe to use rather than a reason to stop.
  const docDir = dirname(docPath);

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
