import { basename, dirname } from '../platform/paths';
import type { EntryPresence, PlatformIO } from '../platform/types';

/**
 * Whether a path is there, with **absent** said only where the disk was seen
 * not to hold it (#729).
 *
 * `entryPresence` on the desktop is the `exists` command of the file system
 * plugin, which answers `Path::exists()`: false for a path that is not there,
 * and false as well when its metadata cannot be read, a folder shut to the
 * person among them. So its **absent** means *not there, or could not be
 * looked at*. A link into a shut folder would be called broken while its
 * target may well be there, which is the one wrong answer the broken link
 * check must not give: what is not established is listed as not checked.
 *
 * So an absent answer is taken as absent only when the nearest folder above
 * the path that is there can be listed and does not hold the next name down.
 * A listing that fails, a listing that holds the name all the same, or no
 * folder above that is there, is **unknown**. A present or unknown answer is
 * returned as `entryPresence` gave it.
 *
 * `memo` keeps what was learnt of each folder for a whole check: a document
 * with many links into one folder asks of that folder once and lists it once.
 * Measured on #729: a thousand links, half of them to files not there, took
 * 2964 ms on a Linux runner when the folder was asked of for each of them.
 */
export interface FolderMemo {
  readonly presence: Map<string, Promise<EntryPresence>>;
  readonly listings: Map<string, Promise<ReadonlySet<string> | null>>;
}

export function createFolderMemo(): FolderMemo {
  return { presence: new Map(), listings: new Map() };
}

export async function establishedPresence(
  io: PlatformIO,
  path: string,
  memo: FolderMemo = createFolderMemo(),
): Promise<EntryPresence> {
  const first = await io.entryPresence(path);
  if (first !== 'absent') return first;
  let child = path;
  // Bounded: each pass takes one segment off the path, and a root ends it.
  for (let pass = 0; pass < MAX_FOLDERS_UP; pass += 1) {
    const folder = dirname(child);
    if (folder === child || isRoot(folder)) return 'unknown';
    // A path with no root is a place in the folder the web build was granted,
    // and its top is that folder, there by the grant: it is listed as it is.
    const presence = folder === '' ? 'present' : await folderPresence(io, folder, memo);
    if (presence === 'unknown') return 'unknown';
    if (presence === 'present') {
      const names = await listingOf(io, folder, memo.listings);
      if (names === null || names.has(basename(child))) return 'unknown';
      return 'absent';
    }
    child = folder;
  }
  return 'unknown';
}

function folderPresence(io: PlatformIO, folder: string, memo: FolderMemo): Promise<EntryPresence> {
  const known = memo.presence.get(folder);
  if (known) return known;
  const asked = io.entryPresence(folder);
  memo.presence.set(folder, asked);
  return asked;
}

/** More folders up than any path of the disk holds is taken as unknown. */
const MAX_FOLDERS_UP = 64;

/**
 * A root is not listed: `C:` alone names the current folder of the drive on
 * Windows rather than its root, and a share or `/` is the top of what the
 * document can reach.
 */
function isRoot(folder: string): boolean {
  return folder === '/' || /^[A-Za-z]:$/.test(folder) || /^\/\/[^/]+(\/[^/]+)?$/.test(folder);
}

function listingOf(
  io: PlatformIO,
  folder: string,
  listings: Map<string, Promise<ReadonlySet<string> | null>>,
): Promise<ReadonlySet<string> | null> {
  const known = listings.get(folder);
  if (known) return known;
  const listing = io.listDir(folder).then(
    (entries) => new Set(entries.map((entry) => entry.name)),
    (e: unknown) => {
      // Told to the console and answered unknown, never as empty: a folder
      // that could not be listed says nothing about what it holds (#58).
      console.warn('[agented] could not list a folder to confirm a missing file:', folder, e);
      return null;
    },
  );
  listings.set(folder, listing);
  return listing;
}
