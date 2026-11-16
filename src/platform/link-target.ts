import { isRelativeLinkAddress } from '../editor/link-url';
import { decodePercentEscapes, isMarkdownPath, normalize } from './paths';

/**
 * Where a relative link points on disk (#727): the one answer to that question,
 * for following a link now and, later, for the broken link check and renaming.
 * It takes the path of the document and the address the link holds, and gives a
 * path or the reason there is none; it knows nothing of the click, the
 * platform or the disk.
 *
 * **It never yields a path on another machine from a document on a local
 * disk.** On Windows a path to a network share is a network connection (Q3),
 * and opening one can hand the credentials of the person to that machine. So
 * the path is built from the root of the document - a drive, `/`, the
 * `//host/share` of a document opened from a share, or the share or drive a
 * Windows device path names - and the clean segments of
 * the address, never from a root the address spells: an address that starts
 * with `/` or a backslash is refused before anything else, `..` stops at the
 * root of the document instead of climbing past it, and empty segments are
 * dropped, so no `//` can appear inside the path built. The only route to a
 * share is a document opened from that share.
 */
export type LinkTarget =
  | { readonly kind: 'file'; readonly path: string; readonly markdown: boolean }
  | { readonly kind: 'refused'; readonly reason: LinkRefusal };

export type LinkRefusal =
  /** Not a relative address: a web link, another scheme, a host. */
  | 'not-relative'
  /** An anchor alone, `#setup`: going to a heading is not supported yet. */
  | 'anchor-only'
  /** Starts with `/` or a backslash: it depends on a root AgentEd does not know. */
  | 'rooted'
  /** The document has no file yet, so there is no folder to start from. */
  | 'no-document'
  /** Names a folder, by a trailing separator or by naming the root itself. */
  | 'folder'
  /** Climbs above the root of the document: the drive, `/`, or the share. */
  | 'above-root';

/** The root a document path starts from, and the folders below it. */
interface Rooted {
  readonly root: string;
  readonly folders: string[];
}

/**
 * Split the folder of a document into its root and its folders, on `/` and
 * backslash alike: `//host/share` for a share, `C:` for a drive, `/` for any
 * other absolute path, nothing for a path with no root (the web build names a
 * document by its place in the granted folder).
 */
function splitDocumentFolder(documentPath: string): Rooted {
  const path = normalize(documentPath);
  const parts = path.split('/');
  parts.pop();
  if (/^\/\/[?.]\//.test(path)) {
    // A Windows device path, `\\?\` or `\\.\`: its root takes the share of
    // `\\?\UNC\host\share`, and the drive or volume otherwise, so `..` can no
    // more climb to another host from it than from `\\host\share`.
    const segments = parts.filter((s) => s.length > 0);
    const take = segments[1]?.toUpperCase() === 'UNC' ? 4 : 2;
    return { root: `//${segments.slice(0, take).join('/')}`, folders: segments.slice(take) };
  }
  if (/^\/\/[^/]/.test(path)) {
    const segments = parts.filter((s) => s.length > 0);
    return { root: `//${segments.slice(0, 2).join('/')}`, folders: segments.slice(2) };
  }
  if (/^[A-Za-z]:/.test(path)) {
    const segments = parts.filter((s) => s.length > 0);
    return { root: segments[0], folders: segments.slice(1) };
  }
  return { root: path.startsWith('/') ? '/' : '', folders: parts.filter((s) => s.length > 0) };
}

function joinRooted(root: string, segments: readonly string[]): string {
  if (root === '/') return `/${segments.join('/')}`;
  if (root === '') return segments.join('/');
  return `${root}/${segments.join('/')}`;
}

/** The address with its query and fragment dropped. */
function pathPart(address: string): string {
  const cut = address.search(/[?#]/);
  return cut === -1 ? address : address.slice(0, cut);
}

export function resolveLinkTarget(documentPath: string | null, address: string): LinkTarget {
  if (!isRelativeLinkAddress(address)) return { kind: 'refused', reason: 'not-relative' };
  const spelled = pathPart(address);
  if (spelled === '') return { kind: 'refused', reason: 'anchor-only' };
  if (spelled.startsWith('/') || spelled.startsWith('\\'))
    return { kind: 'refused', reason: 'rooted' };
  if (documentPath === null) return { kind: 'refused', reason: 'no-document' };

  // The percent rule of images (#454): one reading of an address for every
  // place that turns one into a disk path. An escaped separator stays as
  // written, so it cannot make a folder boundary the address did not spell.
  const decoded = decodePercentEscapes(spelled);
  if (/[/\\]$/.test(decoded)) return { kind: 'refused', reason: 'folder' };

  const { root, folders } = splitDocumentFolder(documentPath);
  const stack = [...folders];
  // Bounded by the segments of the address: one pass each.
  for (const segment of decoded.split(/[/\\]/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) return { kind: 'refused', reason: 'above-root' };
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  // On Windows a link never resolves to the root of a drive, nor anywhere to
  // the root of the document: a root is a folder.
  if (stack.length === 0) return { kind: 'refused', reason: 'folder' };
  const path = joinRooted(root, stack);
  return { kind: 'file', path, markdown: isMarkdownPath(path) };
}
