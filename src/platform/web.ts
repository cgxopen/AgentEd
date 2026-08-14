import { joinPath } from './paths';
import type { FileEntry, FileResult, PlatformIO } from './types';

export class WebIO implements PlatformIO {
  readonly supportsMultiFile = true;
  private fileHandle: FileSystemFileHandle | null = null;
  private dirHandle: FileSystemDirectoryHandle | null = null;
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

  async saveFileAs(
    content: string,
    filterName = 'Markdown file',
    extensions = ['md'],
  ): Promise<string | null> {
    try {
      const accept: Record<string, string[]> = {
        'text/markdown': extensions.map((e) => `.${e}`),
      };
      const handle = await window.showSaveFilePicker({
        suggestedName: `document.${extensions[0]}`,
        types: [{ description: filterName, accept }],
      });
      this.fileHandle = handle;
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      // Acquire directory handle for multi-file operations
      await this.acquireDirectoryHandle();
      return handle.name;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      console.error('saveFileAs failed:', e);
      return null;
    }
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

  // Reads return safe defaults — absent file and missing dirHandle are
  // indistinguishable at read level and both have the same legitimate
  // fallback; writes must be loud to prevent silent data loss.
  async exists(path: string): Promise<boolean> {
    if (!this.dirHandle) return false;
    try {
      await this.navigateTo(path);
      return true;
    } catch {
      return false;
    }
  }

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
    } catch {
      return [];
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
