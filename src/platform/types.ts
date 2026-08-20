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

export interface PlatformIO {
  /** Whether this platform can write to multiple file paths (directories, attachments) */
  readonly supportsMultiFile: boolean;
  openFile(path?: string): Promise<FileResult | null>;
  /** Show a file picker with custom filter; returns absolute path or null if cancelled */
  pickFile(filterName: string, extensions: string[]): Promise<string | null>;
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
  exists(path: string): Promise<boolean>;
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
