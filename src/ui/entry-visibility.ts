/**
 * What a folder entry is to the person (#721): **shown**, **counted**, or **left
 * out**. One answer for the two places that describe a folder, the files panel
 * (R-C6) and the Images popover (R-C12), so what the panel would not list the
 * popover does not count.
 *
 * - **Left out**: drawn nowhere and counted nowhere, at any depth, Show or not.
 *   The files a system leaves, by name, compared without regard to letter case,
 *   the folder `.git` with them; and every other file whose name starts with a
 *   dot, `.gitkeep` or `.gitignore` for instance.
 * - **Counted**: a folder whose name starts with a dot, other than a system one.
 *   It is drawn hidden and counted as one, and Show reveals it (#717).
 * - **Shown**: everything else.
 *
 * By name only, the same on every platform: the walk lists hidden-attribute
 * files on Windows as any other (measured on #721 through `std::fs::read_dir`,
 * which the fs plugin reads with), so a name list is what keeps them out.
 */

export type EntryVisibility = 'shown' | 'counted' | 'left-out';

/** The names a system leaves in a folder, in lower case (#721, the list of the issue). */
const SYSTEM_NAMES: ReadonlySet<string> = new Set([
  '.ds_store',
  'thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '.spotlight-v100',
  '.trashes',
  '.fseventsd',
  '$recycle.bin',
  'system volume information',
  '.git',
]);

/** The prefix of the files macOS writes beside others on a foreign disk, `._photo.png`. */
const APPLE_DOUBLE_PREFIX = '._';

export function entryVisibility(name: string, isDirectory: boolean): EntryVisibility {
  const lower = name.toLowerCase();
  if (SYSTEM_NAMES.has(lower) || lower.startsWith(APPLE_DOUBLE_PREFIX)) return 'left-out';
  if (!name.startsWith('.')) return 'shown';
  return isDirectory ? 'counted' : 'left-out';
}
