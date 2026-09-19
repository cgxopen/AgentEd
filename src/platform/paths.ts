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
 * if the textual prefix matches. **What stands behind it is the shell
 * scope and nothing else** (#220, #249). The `open` scope in
 * `src-tauri/tauri.conf.json` is an extension whitelist, so a symlink
 * to an executable is refused there when `sidebar-click.ts` hands a
 * path to the OS. The `fs` scope in `src-tauri/capabilities/default.json`
 * allows `**`, so it refuses nothing: a symlink inside the listed root
 * that points outside passes this check and then passes that scope too.
 * The sentence that used to stand here named both scopes, and the `fs`
 * half had nothing at the address it named. Whether the `fs` scope
 * should narrow is a product question at the #20 gate, not a defect
 * here.
 */
export function isPathInsideRoot(target: string, root: string): boolean {
  const normRoot = collapseDotSegments(root).replace(/\/+$/, '');
  const normTarget = collapseDotSegments(target).replace(/\/+$/, '');
  if (normRoot.length === 0) return false;
  if (normTarget === normRoot) return true;
  return normTarget.startsWith(`${normRoot}/`);
}

/**
 * Whether two paths name the same file, for a list that must hold each file
 * once (#381).
 *
 * **A path that starts with a drive letter or a network share is compared
 * without case**, because it is a Windows path and Windows does not tell
 * `C:\Notes\a.md` from `c:\notes\A.md`. The picker and the files panel
 * hand a path as the disk spells it, but a command line typed by hand can
 * spell the same file otherwise, and nothing in this layer canonicalises a
 * path. Any other path is compared exactly, as a case-sensitive filesystem
 * reads it.
 *
 * Decided by the shape of the path rather than by the platform, since the
 * shape is what says which rule the file follows. What it does not know: a
 * Windows folder switched to case sensitivity, which is rare enough to leave.
 */
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/**
 * The form `samePath` compares, for a caller that holds many paths: two paths
 * are the same file exactly when their keys are equal, so a set of keys
 * answers for a whole list in one lookup.
 */
export function pathKey(path: string): string {
  const slashed = normalize(path);
  return /^[A-Za-z]:\//.test(slashed) || slashed.startsWith('//') ? slashed.toLowerCase() : slashed;
}
