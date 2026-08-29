export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FileResult {
  content: string;
  path: string;
}

/**
 * A file the user picked from a dialog: how to reach its bytes, and what
 * it is called.
 *
 * **Two fields because they are two different things**, which a single
 * string could not say (#145). On the desktop the reference is an
 * absolute path and the name is its last segment; on the web there is no
 * path at all — `WebIO` keeps the handle in a registry and answers a
 * token that finds it again. A caller given only that token had no way
 * to recover the name, and the one that tried took `basename` of it,
 * which on a value with no slash returns the whole thing, prefix
 * included. That prefix then reached a file written to disk.
 *
 * So the platform says both, and nothing above `src/platform` has to
 * know what either looks like on a given target — the same reasoning
 * `canWriteCompanions` is written to (#46, #123).
 */
export interface PickedFile {
  /**
   * What `readBinary` resolves to these bytes. **Opaque**: it is a path
   * on one platform and a registry token on another, and no caller may
   * parse it, display it, or derive a name from it.
   */
  readonly ref: string;
  /**
   * The file's own name, as the user knows it — `Diagramă finală.png`.
   * This is what R-C5 says an inserted image keeps, and it is the only
   * value a caller should name the file by.
   */
  readonly name: string;
}

/**
 * What a platform could observe about a file at a given moment (R-C14).
 *
 * The three cases are deliberately distinct. `absent` is a fact — the
 * file is not there, so there is nothing to overwrite. `unreadable` is
 * an admission — the platform could not tell, which is **not** the same
 * answer and must never be treated as "nothing changed".
 */
export type FileSnapshot =
  | { readonly kind: 'file'; readonly text: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly cause: unknown };

/**
 * Guard consulted before the platform closes the window or quits the app.
 *
 * `confirmClose` runs the same unsaved-changes gate the in-app actions use
 * and resolves `true` when the close may proceed. `hasUnsavedChanges` is a
 * synchronous fallback for platforms that cannot await a decision — the web
 * build can only ask the browser to show its own generic prompt.
 */
export interface CloseGuard {
  hasUnsavedChanges(): boolean;
  confirmClose(): Promise<boolean>;
}

/**
 * What a platform could observe about an entry at a given path.
 *
 * `present` and `absent` are facts. `unknown` is an admission: the
 * lookup did not happen — a permission that is gone, a component of the
 * path that is not the kind of thing it was walked as, a platform with
 * nothing granted to look inside. It is deliberately not spelled
 * `unreadable`, which `FileSnapshot` already uses for a file whose
 * *contents* could not be read; this one is about the lookup itself.
 */
export type EntryPresence = 'present' | 'absent' | 'unknown';

/**
 * The marker on a read that **did not happen for a reason other than
 * the file being absent** (#173).
 *
 * A term of the platform contract rather than a message: the wording
 * layer reads it to choose a sentence, and `'omit'` at the call site
 * keeps it off the screen. It is written here and matched in
 * `app/open-failure.ts`, so the string exists once — the same seam
 * `NO_DIR_HANDLE` uses, and the reason a shared constant is better than
 * the literal it repeats.
 *
 * **Matching our own marker is not the mistake `entryPresence` refuses
 * to make.** That rule is about the operating system's or the browser's
 * own prose, which translates; this string is written by AgentEd and
 * does not. The browser's own answer is told apart one layer down, by
 * `DOMException.name`, and never by its message.
 *
 * **It claims only what it says.** The read was refused; which state the
 * browser was in — a lapsed grant, a revoked one, a path component that
 * is a file — is not established here and is not claimed anywhere.
 */
export const READ_REFUSED = 'READ_REFUSED';

export interface PlatformIO {
  /** Whether this platform can write to multiple file paths (directories, attachments) */
  readonly supportsMultiFile: boolean;
  /**
   * Whether a companion file — `assets/` next to `documentPath` — can be
   * written **right now** (#46).
   *
   * This is a question about *state*, which is what separates it from
   * `supportsMultiFile` above: that one is a declaration about the build,
   * a constant, and it cannot answer this. On the web build the answer
   * turns on whether a directory handle has been granted in this session,
   * which changes the moment the user completes a Save As.
   *
   * **It takes the document's path because only the platform knows what
   * its own paths look like.** A desktop path always carries a directory,
   * so a bare name there is malformed and gets a `false`; a web path never
   * carries one, because `assets/` is resolved against the granted
   * directory rather than against a parent. Asking here keeps that
   * knowledge inside `src/platform`, where CLAUDE.md puts it — the app
   * layer would otherwise have to branch on `isTauri` to know which shape
   * it is holding.
   *
   * A boolean, deliberately: the *fact* belongs to the platform layer and
   * the *words* belong to the app layer, which is the seam #61 drew.
   *
   * **Async even though no implementation awaits anything today.** The
   * honest check for File System Access is `queryPermission({ mode:
   * 'readwrite' })`, which is asynchronous. It is not needed yet, because
   * the handle lives in memory and its permission was granted in this same
   * session — it becomes needed the day handles are persisted to
   * IndexedDB. `Promise<boolean>` makes that change free; a synchronous
   * getter would close the door.
   */
  canWriteCompanions(documentPath: string): Promise<boolean>;
  openFile(path?: string): Promise<FileResult | null>;
  /**
   * Show a file picker with a custom filter. Answers the picked file's
   * reference **and** its name (#145), or `null` if cancelled — never a
   * bare string, because on the web the two are not recoverable from
   * each other.
   */
  pickFile(filterName: string, extensions: string[]): Promise<PickedFile | null>;
  readText(path: string): Promise<string>;
  saveFile(path: string, content: string): Promise<void>;
  /**
   * Read the current on-disk text of `path` without throwing, so the save
   * flow can tell whether the file changed since AgentEd last saw it
   * (R-C14). Reports "not there" and "could not read" as different
   * answers — see `FileSnapshot`.
   */
  readSnapshot(path: string): Promise<FileSnapshot>;
  /**
   * Ask the user where to save, and return the chosen path (or `null` when
   * cancelled). **Picking a destination writes nothing** — R-C3 allows a
   * write only from an explicit save decision, and the caller performs it
   * through `saveFile`. Choosing an existing file must never truncate it.
   */
  pickSavePath(filterName?: string, extensions?: string[]): Promise<string | null>;
  /**
   * Route window close / app quit through `guard` (R-C3). Called once at
   * startup. Platforms that cannot intercept the close asynchronously fall
   * back to their native prompt.
   */
  installCloseGuard(guard: CloseGuard): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  /**
   * Whether something is at `path`, as three answers rather than two.
   *
   * **`unknown` is not `absent`** — the distinction #55 drew for
   * `FileSnapshot` and #126 had to draw again here. A lookup that could
   * not be performed is not a lookup that found nothing, and a boolean
   * has nowhere to put the difference: whichever way it leans, it lies
   * to the callers that need the other one.
   *
   * That is not hypothetical. This was a `boolean`, and #58 leaned it
   * toward *there might be something there* so that an unreadable
   * `assets/` folder could not be mistaken for an empty one. It was the
   * right answer for one caller out of five, and it made the context
   * indicator report six files nobody could open (#126). The direction
   * was never the defect; having a direction at all was.
   *
   * So the primitive states what it observed and every caller says what
   * it wants done about `unknown`, in its own code:
   *
   * - `readAssetsFolder` (`src/editor/image-handler.ts`) refuses the
   *   insert on anything but `absent` — nothing may be overwritten, so
   *   an unanswered lookup is not permission to claim a name (R-C5).
   * - `probeOne` (`src/cluster/detector.ts`) counts only `present` — the
   *   indicator names files that were found to be there (R-A2).
   * - `shouldShowSidebar` (`src/app/sidebar-sync.ts`), twice, likewise:
   *   a root is shown only when it was found.
   * - `resolveAssetsDir` (`src/app/assets-dir.ts`) treats anything but
   *   `absent` as already there, which is what keeps it from offering to
   *   create a folder it cannot see.
   *
   * **Never rejects.** A failure is one of its answers, so a caller
   * cannot be written that forgets to handle it — the `catch` that used
   * to stand for this is where the two states were merged.
   */
  entryPresence(path: string): Promise<EntryPresence>;
  listDir(path: string): Promise<FileEntry[]>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  /**
   * Open `path` with the host OS's default application for that
   * file type (Tauri-only). Throws on Web — there's no equivalent
   * primitive in the browser File System Access API.
   */
  openWithSystem(path: string): Promise<void>;
}
