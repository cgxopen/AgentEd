/**
 * Path manipulation helpers. Everything operates on forward-slash paths;
 * inputs with backslashes are normalized at the boundary. Native Tauri
 * APIs on Windows may hand us backslash-separated paths — converting to
 * '/' once at the edge keeps downstream string matches (endsWith('/'),
 * split('/'), etc.) uniform.
 *
 * These helpers do NOT touch the filesystem. They are pure string ops.
 */

export function normalize(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Last path segment: "/foo/bar.md" → "bar.md", "foo" → "foo". */
export function basename(path: string): string {
  const trimmed = normalize(path).replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** Directory portion: "/foo/bar.md" → "/foo", "bar.md" → "". */
export function dirname(path: string): string {
  const trimmed = normalize(path).replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx === -1) return '';
  if (idx === 0) return '/';
  return trimmed.slice(0, idx);
}

/** Remove final extension: "doc.md" → "doc", "foo.tar.gz" → "foo.tar". */
export function stripExtension(path: string): string {
  return path.replace(/\.[^/.]+$/, '');
}

/**
 * Join path segments with `/`, stripping duplicate and trailing slashes.
 * Preserves a leading slash on the first segment (absolute paths).
 * Empty or falsy segments are dropped.
 */
export function joinPath(...parts: string[]): string {
  const nonEmpty = parts.map(normalize).filter((p) => p.length > 0);
  if (nonEmpty.length === 0) return '';
  const isAbsolute = nonEmpty[0].startsWith('/');
  const segments = nonEmpty.flatMap((p) => p.split('/').filter((s) => s.length > 0));
  const joined = segments.join('/');
  return isAbsolute ? `/${joined}` : joined;
}

/**
 * Collapse `.` and `..` segments without touching the filesystem.
 * Used for path-traversal validation. Symlink resolution is not
 * performed — that's the OS's job; AgentEd's path scope (Tauri fs
 * capability) catches symlinked escapes at runtime.
 */
export function collapseDotSegments(path: string): string {
  const norm = normalize(path);
  const isAbsolute = norm.startsWith('/');
  const parts = norm.split('/').filter((p) => p.length > 0);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return (isAbsolute ? '/' : '') + stack.join('/');
}

/**
 * Whether this path names a markdown document, by its extension (#146).
 *
 * **One predicate, two askers.** The sidebar's renderer needs it to know
 * whether an entry is actionable before it draws one, and the click
 * handler needs it to route a click. Written twice, the two would answer
 * the same question and could drift into answering it differently — and
 * `TreeNode.kind` cannot carry it, since it distinguishes only a file
 * from a directory.
 *
 * A pure question about a name: no filesystem access, no platform. Case
 * is folded because a file called `NOTES.MD` is a markdown document on
 * every system this runs on.
 */
export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

/**
 * True iff `target` resolves strictly inside `root` after collapsing
 * `..` segments. Both inputs are treated as forward-slash paths.
 *
 *  - `target === root` → true (root is its own ancestor by convention here)
 *  - `target` outside root after collapse → false
 *
 * This is a string-level check; symlinks pointing outside still pass
 * if the textual prefix matches. Defense in depth: AgentEd relies on
 * the Tauri fs/shell scope at the OS level for the symlink case.
 */
export function isPathInsideRoot(target: string, root: string): boolean {
  const normRoot = collapseDotSegments(root).replace(/\/+$/, '');
  const normTarget = collapseDotSegments(target).replace(/\/+$/, '');
  if (normRoot.length === 0) return false;
  if (normTarget === normRoot) return true;
  return normTarget.startsWith(`${normRoot}/`);
}
