import { joinPath } from './paths';
import type {
  CloseGuard,
  EntryPresence,
  FileEntry,
  FileResult,
  FileSnapshot,
  PlatformIO,
} from './types';

/**
 * Whether a File System Access rejection means *there is nothing there*.
 *
 * **The name, never the message.** `DOMException.name` is part of the
 * API and reads the same in every locale; the message beside it is prose
 * the browser writes and translates. `readSnapshot` has asked the
 * question this way since #55, and #58 gave it two more askers — which
 * is what turned it into a function.
 *
 * Everything that is not a `NotFoundError` is a read that did not
 * happen. That is not the same answer as an empty folder, and this file
 * used to deliver it as one.
 */
function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

export class WebIO implements PlatformIO {
  readonly supportsMultiFile = true;
  private fileHandle: FileSystemFileHandle | null = null;
  private dirHandle: FileSystemDirectoryHandle | null = null;

  /**
   * Whether a directory handle has been granted in this session (#46).
   *
   * `documentPath` is deliberately unused here, and that is the whole
   * difference between this platform and the desktop one: a web path
   * carries no root — `pickSavePath` returns `handle.name`, and `openFile`
   * returns at best a path relative to the granted folder (#141) — so
   * there is no parent to answer from. `assets/` is resolved against
   * `dirHandle`, so the handle is the entire answer.
   *
   * `pickSavePath` is what acquires that handle, which is why the insert
   * flow asks this **after** the destination step rather than before: ask
   * it first and the answer is stale in exactly the case the step just
   * repaired.
   *
   * Nothing is awaited today. The honest check is `queryPermission({ mode:
   * 'readwrite' })` on the handle, and it becomes necessary the day these
   * handles are persisted to IndexedDB and survive the session that
   * granted them; today the permission and the handle were granted in this
   * one. The signature is async so that day costs nothing here.
   */
  async canWriteCompanions(_documentPath: string): Promise<boolean> {
    return this.dirHandle !== null;
  }
  /** Transient file handles from pickFile(), keyed by the returned pseudo-path */
  private pickedFiles = new Map<string, FileSystemFileHandle>();

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
   * cannot exist. `takeDocument` both sets and clears it, so the
   * re-anchoring #142 established — a Save As never leaving a stale
   * registration to shadow the destination it just picked — holds by
   * construction rather than by a separate line remembering to.
   */
  private documentFile: { path: string; handle: FileSystemFileHandle } | null = null;

  async openFile(_path?: string): Promise<FileResult | null> {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'AgentEd files',
            accept: {
              'text/markdown': ['.md', '.markdown'],
              'text/plain': ['.txt'],
            },
          },
        ],
      });
      this.fileHandle = handle;
      const file = await handle.getFile();
      const content = await file.text();
      // The content goes back with the path: the caller has been handed
      // the text this platform read from the picked handle itself, and
      // re-reading it by name is the lookup that went wrong (#141).
      //
      // Nothing changes the grant on this route, so there is no ordering
      // question here — unlike `pickSavePath`, which acquires one.
      return { content, path: await this.takeDocument(handle) };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      console.error('openFile failed:', e);
      return null;
    }
  }

  async pickFile(filterName: string, extensions: string[]): Promise<string | null> {
    try {
      const accept: Record<string, string[]> = {
        'application/octet-stream': extensions.map((e) => `.${e}`),
      };
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: filterName, accept }],
      });
      const pseudoPath = `picked:${handle.name}`;
      this.pickedFiles.set(pseudoPath, handle);
      return pseudoPath;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      console.error('pickFile failed:', e);
      return null;
    }
  }

  /**
   * The text at `path`, or a rejection — never the text of some other
   * document (#127).
   *
   * This used to fall back to the open document whenever
   * `resolveFileHandle` answered `null`, which it does on **every**
   * failure and not only on not-found. So a read of a path that could
   * not be resolved returned a different file's contents, successfully,
   * and `applyBundle` then set `filePath` and the R-C14 baseline from
   * it: the user was looking at their own document under a name the
   * application had invented (R-C6, which says the sidebar switches
   * focus to *that* file).
   *
   * The legitimate half of that fallback is kept and is now the only
   * half — see `grantedFileFor`.
   */
  async readText(path: string): Promise<string> {
    const handle =
      this.documentFileFor(path) ??
      (await this.resolveFileHandle(path)) ??
      this.grantedFileFor(path);
    if (!handle) throw new Error(`Could not resolve a file handle for: ${path}`);
    const file = await handle.getFile();
    return await file.text();
  }

  async saveFile(path: string, content: string): Promise<void> {
    const handle = await this.resolveOrCreateFileHandle(path);
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /**
   * Read the file as it is on disk right now (R-C14). `getFile()` returns
   * a fresh snapshot every call, so the web build compares the same thing
   * the Tauri build does — the file's current text — and makes the same
   * promise for any file it can reach. What it cannot reach it says so
   * about (`unreadable`) rather than reporting a reassuring `absent`.
   */
  async readSnapshot(path: string): Promise<FileSnapshot> {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop() ?? '';
    const opened = this.documentFileFor(path);
    const granted = this.grantedFileFor(path);
    let handle: FileSystemFileHandle;
    if (opened) {
      // The file File → Open was handed, under the path answered for it
      // (#141). It is exactly the file `saveFile` writes for this path,
      // so it is exactly the file R-C14 has to compare against — asking
      // the granted folder instead answers about a different file, and
      // then the user is shown a conflict about a document they never
      // opened.
      handle = opened;
    } else if (this.dirHandle) {
      try {
        const dir = await this.navigateToDirByParts(parts, false);
        handle = await dir.getFileHandle(name);
      } catch (e) {
        if (isNotFound(e)) return { kind: 'absent' };
        return { kind: 'unreadable', cause: e };
      }
    } else if (granted) {
      // The one file this platform was granted, named by itself — the
      // rule `grantedFileFor` holds for all four sites (#127). It is
      // exactly the file a save would write.
      handle = granted;
    } else {
      return {
        kind: 'unreadable',
        cause: new Error(
          'NO_DIR_HANDLE: web mode cannot inspect files other than the one initially opened',
        ),
      };
    }

    try {
      const file = await handle.getFile();
      return { kind: 'file', text: await file.text() };
    } catch (e) {
      if (isNotFound(e)) return { kind: 'absent' };
      return { kind: 'unreadable', cause: e };
    }
  }

  async pickSavePath(filterName = 'Markdown file', extensions = ['md']): Promise<string | null> {
    try {
      const accept: Record<string, string[]> = {
        'text/markdown': extensions.map((e) => `.${e}`),
      };
      const handle = await window.showSaveFilePicker({
        suggestedName: `document.${extensions[0]}`,
        types: [{ description: filterName, accept }],
      });
      // Keep the handle so saveFile() can write to it later, but do NOT
      // open a writable stream here: createWritable() truncates the file,
      // which would destroy an existing document the moment the user picks
      // it in the dialog — before any save decision (R-C3).
      this.fileHandle = handle;
      // Acquire directory handle for multi-file operations
      await this.acquireDirectoryHandle();
      // **After the grant, never before** (#144). This picker acquires a
      // folder in the same gesture, and on the ordinary first save that
      // folder is the one the destination lives in — so a question asked
      // one line earlier is asked of a grant that does not exist yet, and
      // answers with a bare name for a file the application is about to
      // be able to name in full.
      //
      // `takeDocument` also re-anchors: Save As replaces the document, and
      // a registration left from File → Open would otherwise go on
      // shadowing the destination just picked (#142).
      return await this.takeDocument(handle);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      console.error('pickSavePath failed:', e);
      return null;
    }
  }

  /**
   * The browser cannot await an in-page dialog before unloading, so the
   * best available guard is the native "Leave site?" prompt, requested by
   * cancelling the beforeunload event while the document is dirty.
   * `confirmClose` stays unused here — it has no way to run in time.
   */
  async installCloseGuard(guard: CloseGuard): Promise<void> {
    window.addEventListener('beforeunload', (event) => {
      if (!guard.hasUnsavedChanges()) return;
      event.preventDefault();
      // Legacy field, still required by some browsers to trigger the prompt.
      event.returnValue = '';
    });
  }

  async readBinary(path: string): Promise<Uint8Array> {
    // Picked files from pickFile() are keyed by pseudo-path
    const pickedHandle = this.pickedFiles.get(path);
    if (pickedHandle) {
      const file = await pickedHandle.getFile();
      this.pickedFiles.delete(path); // transient, clean up
      return new Uint8Array(await file.arrayBuffer());
    }
    const handle =
      this.documentFileFor(path) ??
      (await this.resolveFileHandle(path)) ??
      this.grantedFileFor(path);
    if (!handle) throw new Error(`Could not resolve a file handle for: ${path}`);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    if (!this.dirHandle && path.includes('/')) {
      throw new Error(
        'NO_DIR_HANDLE: web mode requires directory access for multi-file operations; use Save As to acquire',
      );
    }
    const handle = await this.resolveOrCreateFileHandle(path);
    const writable = await handle.createWritable();
    await writable.write(data.slice().buffer as ArrayBuffer);
    await writable.close();
  }

  /**
   * The three states this platform can observe, told apart by
   * `DOMException.name` and never by message text (#126).
   *
   * `NotFoundError` is the only rejection that means nothing is there.
   * Everything else — a grant that is gone, a component of the path that
   * turned out to be a file — is a lookup that did not happen, and
   * saying so is the whole point: this used to answer `false` for all of
   * them and then, after #58, `true` for all of them, and both were a
   * guess wearing a fact.
   *
   * With no directory handle the answer is `unknown` rather than
   * `absent`: nothing has been granted, so nothing was looked at.
   */
  async entryPresence(path: string): Promise<EntryPresence> {
    if (!this.dirHandle) return 'unknown';
    try {
      await this.navigateTo(path);
      return 'present';
    } catch (e) {
      return isNotFound(e) ? 'absent' : 'unknown';
    }
  }

  /**
   * The names in `path`.
   *
   * **A folder that cannot be read is not an empty folder** (#58, R-C5).
   * This used to return `[]` for every failure, so a directory the
   * browser refused to enumerate arrived at the naming rule as a folder
   * with nothing in it — worse than the desktop build, which at least
   * threw. Now only a folder that is genuinely not there lists as
   * nothing; everything else is raised, and the caller decides what it
   * means with a second question (`exists`) rather than by reading the
   * error.
   *
   * A missing directory handle stays `[]`: no folder has been granted,
   * so there is no folder to be wrong about. The image insert never
   * reaches here in that state — `canWriteCompanions` answers one step
   * earlier (#46).
   */
  async listDir(path: string): Promise<FileEntry[]> {
    if (!this.dirHandle) return [];
    try {
      const dir = await this.navigateToDir(path);
      const entries: FileEntry[] = [];
      for await (const handle of dir.values()) {
        entries.push({
          name: handle.name,
          path: joinPath(path, handle.name),
          isDirectory: handle.kind === 'directory',
        });
      }
      return entries;
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }

  async mkdir(path: string): Promise<void> {
    if (!this.dirHandle && path.includes('/')) {
      throw new Error(
        'NO_DIR_HANDLE: web mode requires directory access for multi-file operations; use Save As to acquire',
      );
    }
    if (!this.dirHandle) return;
    await this.navigateToDir(path, true);
  }

  async remove(path: string): Promise<void> {
    if (!this.dirHandle && path.includes('/')) {
      throw new Error(
        'NO_DIR_HANDLE: web mode requires directory access for multi-file operations; use Save As to acquire',
      );
    }
    if (!this.dirHandle) return;
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) return;
    try {
      const parent = await this.navigateToDirByParts(parts, false);
      await parent.removeEntry(name, { recursive: true });
    } catch {
      // Entry doesn't exist
    }
  }

  // No equivalent for shell.open in the browser File System Access API.
  // The sidebar's non-.md click flow guards on isTauri before calling
  // openWithSystem, so this branch should never run in practice.
  async openWithSystem(_path: string): Promise<void> {
    throw new Error('openWithSystem is not supported on the web platform');
  }

  // ── Private helpers ──

  private async acquireDirectoryHandle(): Promise<void> {
    try {
      this.dirHandle = await window.showDirectoryPicker({
        id: 'agented-project',
        mode: 'readwrite',
        startIn: 'documents',
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.warn('Directory picker cancelled or unavailable:', e);
    }
  }

  private async navigateToDirByParts(
    parts: string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle> {
    let current = this.dirHandle!;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create });
    }
    return current;
  }

  private async navigateToDir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    if (!this.dirHandle) throw new Error('No directory handle');
    const parts = path.split('/').filter(Boolean);
    return this.navigateToDirByParts(parts, create);
  }

  private async navigateTo(path: string): Promise<FileSystemHandle> {
    if (!this.dirHandle) throw new Error('No directory handle');
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop()!;
    const dir = await this.navigateToDirByParts(parts, false);
    try {
      return await dir.getFileHandle(name);
    } catch {
      return await dir.getDirectoryHandle(name);
    }
  }

  /**
   * Where the granted folder says `handle` is, as a path relative to it
   * — or `null` when it cannot say (#141).
   *
   * `resolve` is the only member of the File System Access API that
   * answers the question this platform kept getting wrong: *which file
   * is this*. When it answers, the path it gives already works with
   * every lookup in this class, and it carries the grant's read-write
   * permission, so the file needs no registration of its own.
   *
   * `null` for all three ways of not knowing: no folder was granted, the
   * file is outside the one that was, and the browser does not implement
   * `resolve`. The caller treats them identically — it falls back to the
   * handle's own name — so telling them apart here would buy nothing.
   */
  private async pathWithinGrant(handle: FileSystemFileHandle): Promise<string | null> {
    const dir = this.dirHandle;
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

  /**
   * Take `handle` as the document this platform now holds, and answer
   * with the path it will be known by (#141, #144).
   *
   * **The one place a document's identity is established.** Both pickers
   * come through here, which is the whole of what #144 was: `openFile`
   * was taught this in #142 and `pickSavePath` was not, so one producer
   * answered a path that identified the file and the other answered a
   * name that did not. A producer that skipped this step reproduced the
   * defect in silence; there is now one step to skip and it returns the
   * value the caller needs, so skipping it is not a thing a caller can
   * quietly do.
   */
  private async takeDocument(handle: FileSystemFileHandle): Promise<string> {
    const within = await this.pathWithinGrant(handle);
    this.documentFile = within === null ? { path: handle.name, handle } : null;
    return within ?? handle.name;
  }

  /**
   * The document this platform is holding, when `path` is exactly the
   * path it answered for it (#141, #144).
   *
   * **The whole path, and the one this class produced** — the same
   * narrowness `grantedFileFor` is written to, and for the same reason.
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
  private documentFileFor(path: string): FileSystemFileHandle | null {
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
   * The rule was written twice before this, in `readSnapshot` and in
   * `resolveOrCreateFileHandle`, the second with a comment saying why —
   * the write path was hardened against exactly this hazard and the read
   * path never was. It lives here now and those two delegate to it,
   * rather than a third copy joining them.
   */
  private grantedFileFor(path: string): FileSystemFileHandle | null {
    if (this.dirHandle) return null;
    if (!this.fileHandle) return null;
    // The whole path, not its last segment. Both earlier copies of this
    // rule compared basenames, which answers `assets/notes.md` with the
    // document called `notes.md` — the very clobber the comment on
    // `resolveOrCreateFileHandle` says it prevents. Nothing reaches that
    // today, because `writeBinary` refuses a path with a folder in it
    // before this is asked; the rule should not depend on a guard
    // somewhere else being there.
    const segments = path.split('/').filter(Boolean);
    if (segments.length !== 1) return null;
    return segments[0] === this.fileHandle.name ? this.fileHandle : null;
  }

  private async resolveFileHandle(path: string): Promise<FileSystemFileHandle | null> {
    if (!this.dirHandle) return null;
    try {
      const parts = path.split('/').filter(Boolean);
      const name = parts.pop()!;
      const dir = await this.navigateToDirByParts(parts, false);
      return await dir.getFileHandle(name);
    } catch {
      return null;
    }
  }

  // Note: without a directory handle the web build can only write the
  // file the user picked; Save As is what upgrades the access.
  private async resolveOrCreateFileHandle(path: string): Promise<FileSystemFileHandle> {
    // The opened file first, and this is the half of #141 that makes the
    // open worth fixing: a read that answers with the picked file and a
    // write that lands somewhere else is not an improvement. Asked
    // before the granted folder because this path is precisely the one
    // the folder cannot name.
    const opened = this.documentFileFor(path);
    if (opened) return opened;
    if (this.dirHandle) {
      const parts = path.split('/').filter(Boolean);
      const name = parts.pop()!;
      const dir = await this.navigateToDirByParts(parts, true);
      return await dir.getFileHandle(name, { create: true });
    }
    // Fileless fallback: without a dirHandle, the only file we can write
    // to is the one the user picked, and only under its own name —
    // otherwise a companion write (e.g. an image under assets/) would
    // clobber the document itself. That rule is `grantedFileFor`, which
    // this comment used to be the only statement of (#127).
    const own = this.grantedFileFor(path);
    if (own) return own;
    throw new Error(
      'NO_DIR_HANDLE: web mode requires directory access to write files ' +
        'other than the one initially opened; use Save As to acquire',
    );
  }
}
