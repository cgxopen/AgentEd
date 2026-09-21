import { decodeFileText } from './decode';
import { DocumentIdentity, type GrantedHandles } from './document-identity';
import { joinPath } from './paths';
import {
  type CloseGuard,
  type EntryPresence,
  FILE_ABSENT,
  type FileEntry,
  type FileResult,
  type FileSnapshot,
  type PickedFile,
  type PlatformIO,
  READ_REFUSED,
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
  readonly pathsOutliveSession = false;
  private fileHandle: FileSystemFileHandle | null = null;
  private dirHandle: FileSystemDirectoryHandle | null = null;

  /**
   * Which file this platform is holding, and the only way to establish
   * it (#149). The rules and the registration live in
   * `document-identity.ts`; the handles above stay here, because they
   * are the platform's grant rather than the document's identity — and
   * because `acquireDirectoryHandle` replaces one of them mid-gesture,
   * so every question wants the value in force at the moment of asking.
   */
  private readonly identity = new DocumentIdentity();

  /** The two handles, as they stand right now, for the identity rules. */
  private handles(): GrantedHandles {
    return { dirHandle: this.dirHandle, fileHandle: this.fileHandle };
  }

  /**
   * Whether the granted folder can hold a companion **beside this
   * document** (#46, #148).
   *
   * It used to answer about the session — *is any folder granted* — and
   * ignore the path it was given. That was right while every web
   * document lived at the grant root, which is what #147 stopped being
   * true: a Save As into a folder the grant cannot reach leaves the
   * document there and the grant here, and `assets/` built from
   * `dirname` of a bare name then resolves against the **grant**. The
   * image landed in one tree and the markdown referencing it in another.
   *
   * **The registration is what separates them, and `dirname` is not.**
   * Measured over the four states this platform has: a document in a
   * subfolder answers `doc/report.md`, and the other three all answer a
   * bare name — the grant root included, because `resolve` returns one
   * segment for it. So an empty parent does not mean the document is
   * unreachable. What means it is `documentFile`: a path is registered
   * exactly when the granted folder could not name the file, which is
   * the question being asked here, and only this class can answer it.
   *
   * With no grant at all the answer stays `false`, unchanged — that is
   * the #46 state and it reaches the same report.
   *
   * **The conservative direction, deliberately.** A browser that does
   * not implement `resolve` registers every document, including ones
   * inside the grant, so companions would be refused where the write
   * would have been correct. That is a real cost and it is the safe
   * side: without `resolve` this platform genuinely cannot tell where
   * the document is, and refusing beats writing into a folder the user
   * did not mean (R-C5).
   *
   * `pickSavePath` is what acquires the handle and what registers the
   * document, which is why the insert flow asks this **after** the
   * destination step rather than before: ask it first and the answer is
   * stale in exactly the case the step just repaired.
   *
   * Nothing is awaited today. The honest check is `queryPermission({ mode:
   * 'readwrite' })` on the handle, and it becomes necessary the day these
   * handles are persisted to IndexedDB and survive the session that
   * granted them; today the permission and the handle were granted in this
   * one. The signature is async so that day costs nothing here.
   */
  async canWriteCompanions(documentPath: string): Promise<boolean> {
    if (!this.dirHandle) return false;
    return this.identity.heldFor(documentPath) === null;
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
      const content = decodeFileText(await file.arrayBuffer(), handle.name);
      // The content goes back with the path: the caller has been handed
      // the text this platform read from the picked handle itself, and
      // re-reading it by name is the lookup that went wrong (#141).
      //
      // Nothing changes the grant on this route, so there is no ordering
      // question here — unlike `pickSavePath`, which acquires one.
      return { content, path: await this.identity.take(handle, this.handles()) };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      console.error('openFile failed:', e);
      return null;
    }
  }

  async pickFile(filterName: string, extensions: string[]): Promise<PickedFile | null> {
    try {
      const accept: Record<string, string[]> = {
        'application/octet-stream': extensions.map((e) => `.${e}`),
      };
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: filterName, accept }],
      });
      // The token is this platform's own spelling and stays inside it
      // (#145). It used to be the whole answer, so the caller's only
      // route to a name was `basename` of it — and `picked:` then
      // reached a file written into `assets/`, which R-C5 says keeps the
      // name the user knows the file by.
      const pseudoPath = `picked:${handle.name}`;
      this.pickedFiles.set(pseudoPath, handle);
      return { ref: pseudoPath, name: handle.name };
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
   * and `applyLoadedDocument` then set `filePath` and the R-C14 baseline from
   * it: the user was looking at their own document under a name the
   * application had invented (R-C6, which says the sidebar switches
   * focus to *that* file).
   *
   * The legitimate half of that fallback is kept and is now the only
   * half — see `grantedFor` in `document-identity.ts`.
   */
  async readText(path: string): Promise<string> {
    const handle =
      this.identity.heldFor(path) ??
      (await this.resolveFileHandle(path)) ??
      this.identity.grantedFor(path, this.handles());
    if (!handle) throw new Error(`Could not resolve a file handle for: ${path}`);
    const file = await handle.getFile();
    // Bytes, then this application's own decoder. `Blob.text` decodes
    // lossily by specification and consumes the mark (#259).
    return decodeFileText(await file.arrayBuffer(), path);
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
    const opened = this.identity.heldFor(path);
    const granted = this.identity.grantedFor(path, this.handles());
    let handle: FileSystemFileHandle;
    if (opened) {
      // The document this platform is holding, under the path answered
      // for it (#141) — by either picker since #147, not File → Open
      // alone, which is what this sentence used to say. It is exactly
      // the file `saveFile` writes for this path, so it is exactly the
      // file R-C14 has to compare against: asking the granted folder
      // instead answers about a different file, and then the user is
      // shown a conflict about a document they never chose.
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
      // rule `grantedFor` holds for all four sites (#127). It is
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
      return { kind: 'file', text: decodeFileText(await file.arrayBuffer(), path) };
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
      // `take` also re-anchors: Save As replaces the document, and
      // a registration left from File → Open would otherwise go on
      // shadowing the destination just picked (#142).
      return await this.identity.take(handle, this.handles());
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
      this.identity.heldFor(path) ??
      (await this.resolveFileHandle(path)) ??
      this.identity.grantedFor(path, this.handles());
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

  /**
   * There is no equivalent of a shell open in the File System Access
   * API, so this rejects. **The rejection is load-bearing** (#146).
   *
   * The comment that stood here said the sidebar guards on `isTauri`
   * before calling this, so the branch never runs. No such guard existed
   * anywhere in the repository, and the branch ran on every web session.
   * A comment asserting a protection that is not there is worse than no
   * comment: it is what stopped anyone looking.
   *
   * **Two production callers, and they want opposite things:**
   *
   *   - `app/link-open.ts:70`, through the `openExternal` callback wired
   *     in `main.ts` — catches this and calls `window.open`. **Links
   *     open on the web because this throws.** Making it resolve would
   *     break link opening in silence, and the whole suite would stay
   *     green: measured on this branch, the mutation turned zero tests
   *     red. `link-open.test.ts` now drives this implementation itself
   *     rather than a stub that rejects on request, so that mutation is
   *     red today.
   *   - `app/sidebar-click.ts:53` — no longer reaches here on the web.
   *     A non-markdown entry is drawn with no click listener at all
   *     (#146), so nothing calls it, rather than something calling it
   *     and swallowing the result.
   *
   * The second caller stopping is why the first one is written down. A
   * reader who sees only the sidebar half could conclude this rejection
   * is now vestigial and remove it.
   */
  async openWithSystem(_path: string): Promise<void> {
    throw new Error('openWithSystem is not supported on the web platform');
  }

  // ── Private helpers ──

  /**
   * Ask the user for a folder, and say whether one was given (#184).
   *
   * **Public, and reached without a member on `PlatformIO`.** The one
   * capability member the contract still carries is recorded as debt —
   * `canWriteCompanions` answers from a handle rather than a permission
   * — and a second that can never be called on the desktop is the shape
   * such a member goes wrong in. `platform/index.ts` reaches this one
   * instead, at the address that already owns the dynamic import and the
   * singleton.
   *
   * There is no desktop counterpart and none is wanted: the line that
   * calls this exists only where a panel is absent for want of a grant,
   * which is the web. A desktop implementation would be dead code, the
   * same shape as the inert entry in #146.
   *
   * Called straight from a click, so the transient user activation
   * `showDirectoryPicker` requires is still in hand.
   */
  async requestFolderAccess(): Promise<boolean> {
    const before = this.dirHandle;
    await this.acquireDirectoryHandle();
    // A cancelled picker leaves the handle as it was, and `false` is
    // what keeps the caller silent about it (#61).
    if (this.dirHandle === null || this.dirHandle === before) return false;
    // The document may have been registered because the *previous* grant
    // could not name it — the state a Save As across folders leaves
    // behind. A new grant is the moment to ask again, and asking here is
    // what makes the offer repair what it appears in rather than
    // describe it (#184).
    await this.identity.reanchor(this.handles());
    return true;
  }

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
   * The handle for `path` inside the granted folder, `null` when there
   * is no granted folder to look in, and a marked rejection when the
   * folder answered — either that there is nothing by that name, or by
   * refusing (#173).
   *
   * The `catch` used to bind nothing and return `null` for every
   * failure, which is the same value the line above returns for *no
   * folder was ever granted*. So a read refused by the browser and a
   * file that had been deleted arrived at the user as one sentence, and
   * that sentence offered both as possibilities because the cause had
   * been discarded three functions earlier.
   *
   * **The branch is `isNotFound` and nothing more.** `NotFoundError` is
   * what the API answers for *there is nothing by that name*, and it is
   * what the four other sites in this file already ask. Everything else
   * is a read that did not happen, and it is reported as exactly that —
   * **no browser state is named**. Which `DOMException` a browser
   * raises for a lapsed grant, a revoked one, or a path component that
   * is a file has not been measured, and a branch claiming one of them
   * would trade a vague truth for a confident guess.
   *
   * **Both outcomes are marked, and that is the point rather than
   * symmetry.** The first draft marked only the refused one and let
   * absent fall through to the bare rejection `readText` raises — which
   * is also what a session with **no granted folder at all** raises,
   * and what every desktop failure raises. Absence would then have been
   * claimed about states nothing had established. A marker is put on an
   * answer this function actually obtained, and on nothing else.
   *
   * **The line above stays unmarked on purpose.** With no `dirHandle`
   * there is no folder to have answered, so the read fails with nothing
   * established and the wording layer claims neither state.
   *
   * **Both calls in the `try` can raise it**, measured: a bare name
   * throws from `getFileHandle`, a nested path from
   * `getDirectoryHandle` inside `navigateToDirByParts`. So the question
   * is asked of the error rather than of which call produced it.
   *
   * The rejections skip nothing that could have answered. The `??`
   * chains in `readText` and `readBinary` end in `grantedFor`, which
   * returns `null` on its first line whenever a `dirHandle` exists —
   * and this function only enters the `try` when one does.
   */
  private async resolveFileHandle(path: string): Promise<FileSystemFileHandle | null> {
    if (!this.dirHandle) return null;
    try {
      const parts = path.split('/').filter(Boolean);
      const name = parts.pop()!;
      const dir = await this.navigateToDirByParts(parts, false);
      return await dir.getFileHandle(name);
    } catch (e) {
      if (isNotFound(e)) {
        throw new Error(`${FILE_ABSENT}: the folder has nothing named ${path}`, { cause: e });
      }
      throw new Error(`${READ_REFUSED}: the folder did not answer for ${path}`, { cause: e });
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
    const opened = this.identity.heldFor(path);
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
    // clobber the document itself. That rule is `grantedFor`, which
    // this comment used to be the only statement of (#127).
    const own = this.identity.grantedFor(path, this.handles());
    if (own) return own;
    throw new Error(
      'NO_DIR_HANDLE: web mode requires directory access to write files ' +
        'other than the one initially opened; use Save As to acquire',
    );
  }
}
