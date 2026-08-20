import type { PlatformIO } from '../platform/types';

/**
 * What the file on disk turned out to be, relative to what AgentEd
 * believes it wrote there last (R-C14).
 *
 * This layer reports; it never asks. The three kinds are the three
 * facts the save flow can act on, and the wording the user reads for
 * each of them lives in `src/app` — the same seam #61 put in place for
 * image inserts.
 */
export type ExternalChange =
  | { readonly kind: 'none' }
  | { readonly kind: 'changed' }
  | { readonly kind: 'unverifiable'; readonly cause: unknown };

/**
 * Compare the file at `path` with the text AgentEd last read from it or
 * wrote to it.
 *
 * `knownText` is `null` when nothing has been observed for this path —
 * a document that has just been given a destination it was never opened
 * from. There is no baseline to compare against, so there is nothing to
 * warn about: that path's protection is the save picker's own "replace
 * this file?" question.
 *
 * A file that is **absent** is not a conflict. Nothing is there to be
 * overwritten, so the save simply recreates the document the user asked
 * to save. A file that could not be **read** is a different answer and
 * is reported as such: "I could not tell" must never be delivered to
 * the user as "nothing changed".
 *
 * The comparison is the file's whole text rather than its timestamp.
 * That is exact in both directions — it never misses a change made by a
 * tool that preserves `mtime`, and, just as important for a prompt the
 * user meets on every save, it never invents one for a sync client that
 * rewrote the same bytes or merely touched the file. The cost is one
 * read of a file the editor already holds in memory in full, and which
 * this very save is about to rewrite in full.
 */
export async function detectExternalChange(
  path: string,
  knownText: string | null,
  io: PlatformIO,
): Promise<ExternalChange> {
  if (knownText === null) return { kind: 'none' };

  const snapshot = await io.readSnapshot(path);
  switch (snapshot.kind) {
    case 'absent':
      return { kind: 'none' };
    case 'unreadable':
      return { kind: 'unverifiable', cause: snapshot.cause };
    case 'file':
      return snapshot.text === knownText ? { kind: 'none' } : { kind: 'changed' };
  }
}
