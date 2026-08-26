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
   * difference between this platform and the desktop one: a web path is a
   * bare file name — `pickSavePath` returns `handle.name` and `openFile`
   * returns the same — so it carries no parent to answer from. `assets/`
   * is resolved against `dirHandle`, so the handle is the entire answer.
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
      return { content, path: handle.name };
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

  async readText(path: string): Promise<string> {
    const handle = await this.resolveFileHandle(path);
    if (handle) {
      const file = await handle.getFile();
      return await file.text();
    }
    if (!this.fileHandle) throw new Error('No file handle available');
    const file = await this.fileHandle.getFile();
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
    let handle: FileSystemFileHandle;
    if (this.dirHandle) {
      try {
        const dir = await this.navigateToDirByParts(parts, false);
        handle = await dir.getFileHandle(name);
      } catch (e) {
        if (isNotFound(e)) return { kind: 'absent' };
        return { kind: 'unreadable', cause: e };
      }
    } else if (this.fileHandle && name === this.fileHandle.name) {
      // Same fallback rule as resolveOrCreateFileHandle: without a
      // directory handle the only file we can see is the one the user
      // picked — which is exactly the file a save would write.
      handle = this.fileHandle;
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
      return handle.name;
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
    const handle = await this.resolveFileHandle(path);
    if (handle) {
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    }
    if (!this.fileHandle) throw new Error('No file handle available');
    const file = await this.fileHandle.getFile();
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
    if (this.dirHandle) {
      const parts = path.split('/').filter(Boolean);
      const name = parts.pop()!;
      const dir = await this.navigateToDirByParts(parts, true);
      return await dir.getFileHandle(name, { create: true });
    }
    // Fileless fallback: without a dirHandle, the only file we can write to
    // is the one the user picked. Require the requested name to match the
    // active file's name — otherwise a companion write (e.g. an image
    // under assets/) would clobber the document itself.
    if (this.fileHandle) {
      const requested = path.split('/').filter(Boolean).pop() ?? '';
      if (requested === this.fileHandle.name) return this.fileHandle;
    }
    throw new Error(
      'NO_DIR_HANDLE: web mode requires directory access to write files ' +
        'other than the one initially opened; use Save As to acquire',
    );
  }
}
