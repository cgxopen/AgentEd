/**
 * Which file this platform is holding, and the one place that decides it.
 *
 * **On the web a path is not an identity.** Both pickers answer a value
 * derived from a handle name, and every place that turns such a value
 * back into a lookup is where this project spent four issues: #126
 * invented context files from a lookup that could not be performed,
 * #127 answered a failed lookup with the document already open, #141
 * answered it with a same-named neighbour inside the granted folder, and
 * #144 wrote a document into one. The search in #143 found them as one
 * class.
 *
 * **None of them lived in the rules below.** All of them behave
 * correctly on every input ever measured. Every one of the four defects
 * lived at a *producer* — a function that took a handle from a picker
 * and answered a path without declaring what it had taken — and nothing
 * anywhere forced it to declare. `takeDocument` (#144) fixed that for
 * the two producers that exist. This module is what makes it true for
 * the third one nobody has written yet: the registration is private
 * here, `take` is the only thing that writes it, and it returns the
 * path the producer needs, so the correct route is also the only
 * exported route to an answer.
 *
 * **What it owns and what it is handed.** It owns `documentFile` —
 * the registration, the state the four defects were about. It is
 * *handed* `dirHandle` and `fileHandle`, which stay with `WebIO`
 * because they are the platform's grant rather than the document's
 * identity: `acquireDirectoryHandle` replaces one of them mid-gesture,
 * and every read here wants the value in force at the moment of asking.
 *
 * **One registry, consulted by reads and by writes.** #141 named the
 * hazard of a read registry and a write registry becoming one object by
 * accident, and #147 answered it: this is not a fallback for a lookup
 * that failed — the shape #127 removed — it is a claim about which file
 * a path names, asked *first* and asked identically by both sides. What
 * differs between them is only what they fall through to, and that
 * composition stays in `WebIO`.
 */

/**
 * The handles `WebIO` holds, as they stand at the moment of asking.
 *
 * Passed rather than owned, and passed on every call rather than at
 * construction: `pickSavePath` acquires a new directory handle in the
 * middle of a gesture, so a copy taken earlier would answer about a
 * grant that has been replaced.
 */
export interface GrantedHandles {
  readonly dirHandle: FileSystemDirectoryHandle | null;
  readonly fileHandle: FileSystemFileHandle | null;
}

export class DocumentIdentity {
  /**
   * The document this platform is holding, under the exact path it
   * answered for it — and **only** when the granted folder cannot name
   * that file itself (#141, #144).
   *
   * On the web a path is not an identity: both pickers used to answer
   * `handle.name`, and every later lookup by that bare name was
   * addressed to something that does not identify the file the user
   * picked. Against a grant it either missed, or found a same-named
   * neighbour at the grant root and answered with that instead —
   * silently, for reads and for writes.
   *
   * Two answers, in this order:
   *
   * **A path the grant can name.** `pathWithinGrant` asks the granted
   * folder where the file is; when it says `doc/report.md`, that path
   * already resolves to this very file through the existing navigation,
   * with the read-write permission the grant carries. Nothing is
   * registered — there is nothing here the ordinary lookup gets wrong,
   * and the path carries a parent, which is what everything built with
   * `dirname` needs (`assets/`, the sidebar root, the context scan).
   *
   * **No such path.** Either no folder was granted, or the file is
   * outside the one that was. Then the name is all there is, and it is
   * this handle's name: it is registered so that name reaches this file
   * and no other. A same-named file inside the grant is shadowed for as
   * long as this document is held, which is the deliberate half of the
   * trade — the alternative is the user's document written into a file
   * they never chose.
   *
   * **One field, not one per picker.** There is exactly one document at
   * a time, and which picker produced it is not a property of it; two
   * fields would need a precedence rule between them for a state that
   * cannot exist. `take` both sets and clears it, so the re-anchoring
   * #142 established — a Save As never leaving a stale registration to
   * shadow the destination it just picked — holds by construction rather
   * than by a separate line remembering to.
   *
   * **It survives File → Close and File → New**, which is recorded debt
   * rather than a decision (STATUS §4): nothing between a close and the
   * next open or Save As reads a bare name, so it is correct because of
   * a guard elsewhere. Giving that debt a home is what this module does;
   * changing when the field is released is not, and would be a
   * behaviour change inside a move.
   */
  private documentFile: { path: string; handle: FileSystemFileHandle } | null = null;

  /**
   * Take `handle` as the document this platform now holds, and answer
   * with the path it will be known by (#141, #144).
   *
   * **The one place a document's identity is established**, and since
   * #149 the only exported one. Both pickers come through here, which is
   * the whole of what #144 was: `openFile` was taught this in #142 and
   * `pickSavePath` was not, so one producer answered a path that
   * identified the file and the other answered a name that did not. A
   * producer that skipped this step reproduced the defect in silence;
   * there is now one step to skip, it returns the value the caller
   * needs, and nothing else can write the registration — so skipping it
   * is not a thing a caller can quietly do.
   */
  async take(handle: FileSystemFileHandle, handles: GrantedHandles): Promise<string> {
    const within = await pathWithinGrant(handle, handles);
    this.documentFile = within === null ? { path: handle.name, handle } : null;
    return within ?? handle.name;
  }

  /**
   * The document this platform is holding, when `path` is exactly the
   * path it answered for it (#141, #144).
   *
   * **The whole path, and the one this class produced** — the same
   * narrowness `grantedFor` is written to, and for the same reason.
   * Nothing matches by basename, nothing matches because a lookup
   * elsewhere failed, and nothing matches a path AgentEd did not itself
   * hand out for this handle.
   *
   * It is asked before the granted folder on the **write** path as well
   * as the read path, and that is the point of #144 rather than a
   * side-effect of it: the file this names is the file the bytes must
   * land in. It stays one registry with one rule for both, and it is a
   * rule about identity — never a fallback for a lookup that failed,
   * which is the shape #127 removed.
   */
  heldFor(path: string): FileSystemFileHandle | null {
    if (!this.documentFile) return null;
    return path === this.documentFile.path ? this.documentFile.handle : null;
  }

  /**
   * The one file this platform was granted, when `path` names **that**
   * file and nothing else.
   *
   * Two conditions, and both are load-bearing (#127):
   *
   * **No directory handle.** A granted folder is the authority on what
   * is inside it; nothing falls back past it. The fallback exists for
   * the session that has only ever been handed a single file — the user
   * picked one, and it is the only thing this platform can see.
   *
   * **The name matches.** Reaching that file under any *other* name is
   * the defect: a read of `notes/AGENTS.md` answering with the document
   * already open, successfully, and the editor then wearing a name the
   * application made up.
   *
   * The rule was written twice before #127, in `readSnapshot` and in
   * `resolveOrCreateFileHandle`, the second with a comment saying why —
   * the write path was hardened against exactly this hazard and the read
   * path never was. It lives in one place now and those two delegate to
   * it, rather than a third copy joining them.
   */
  grantedFor(path: string, handles: GrantedHandles): FileSystemFileHandle | null {
    if (handles.dirHandle) return null;
    if (!handles.fileHandle) return null;
    // The whole path, not its last segment. Both earlier copies of this
    // rule compared basenames, which answers `assets/notes.md` with the
    // document called `notes.md` — the very clobber the comment on
    // `resolveOrCreateFileHandle` says it prevents. Nothing reaches that
    // today, because `writeBinary` refuses a path with a folder in it
    // before this is asked; the rule should not depend on a guard
    // somewhere else being there.
    const segments = path.split('/').filter(Boolean);
    if (segments.length !== 1) return null;
    return segments[0] === handles.fileHandle.name ? handles.fileHandle : null;
  }
}

/**
 * Where the granted folder says `handle` is, as a path relative to it
 * — or `null` when it cannot say (#141).
 *
 * `resolve` is the only member of the File System Access API that
 * answers the question this platform kept getting wrong: *which file
 * is this*. When it answers, the path it gives already works with
 * every lookup in `WebIO`, and it carries the grant's read-write
 * permission, so the file needs no registration of its own.
 *
 * `null` for all three ways of not knowing: no folder was granted, the
 * file is outside the one that was, and the browser does not implement
 * `resolve`. The caller treats them identically — it falls back to the
 * handle's own name — so telling them apart here would buy nothing.
 *
 * **A module function, not a method, and that is the point.** It is
 * the question a producer has to ask, and it is not reachable from
 * outside this file at all — so `take` is not merely the recommended
 * way to obtain a path for a handle, it is the only one. TypeScript's
 * `private` would have said the same thing to the compiler and nothing
 * at all at runtime.
 */
async function pathWithinGrant(
  handle: FileSystemFileHandle,
  handles: GrantedHandles,
): Promise<string | null> {
  const dir = handles.dirHandle;
  if (!dir || typeof dir.resolve !== 'function') return null;
  try {
    const parts = await dir.resolve(handle);
    return parts && parts.length > 0 ? parts.join('/') : null;
  } catch {
    // A grant that has lapsed, or a handle from another file system.
    // Either way this platform cannot name the file from here.
    return null;
  }
}
