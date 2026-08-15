import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  exists as fsExists,
  mkdir as fsMkdir,
  remove as fsRemove,
  readDir,
  readFile,
  readTextFile,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { loadLastOpenedFolder } from '../preferences';
import { dirname, joinPath } from './paths';
import type { CloseGuard, FileEntry, FileResult, PlatformIO } from './types';

export class TauriIO implements PlatformIO {
  readonly supportsMultiFile = true;

  async openFile(path?: string): Promise<FileResult | null> {
    let filePath = path;
    if (!filePath) {
      const lastFolder = loadLastOpenedFolder();
      const selected = await open({
        multiple: false,
        filters: [{ name: 'AgentEd', extensions: ['md', 'markdown', 'txt'] }],
        ...(lastFolder ? { defaultPath: lastFolder } : {}),
      });
      if (!selected) return null;
      filePath = selected as string;
    }
    const content = await readTextFile(filePath);
    return { content, path: filePath };
  }

  async pickFile(filterName: string, extensions: string[]): Promise<string | null> {
    const lastFolder = loadLastOpenedFolder();
    const selected = await open({
      multiple: false,
      filters: [{ name: filterName, extensions }],
      ...(lastFolder ? { defaultPath: lastFolder } : {}),
    });
    return (selected as string | null) ?? null;
  }

  async readText(path: string): Promise<string> {
    return await readTextFile(path);
  }

  async saveFile(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
  }

  async pickSavePath(filterName = 'Markdown', extensions = ['md']): Promise<string | null> {
    // Destination only — nothing is written here. The document reaches disk
    // through saveFile(), once the user has actually decided to save.
    return await save({ filters: [{ name: filterName, extensions }] });
  }

  /**
   * Intercept the native close (title-bar ✕, Alt+F4, app quit) and hand the
   * decision to the guard. `preventDefault` keeps the window alive while the
   * dialog is open; `destroy()` then closes it without re-entering this
   * handler. Each window installs its own guard, so quitting with several
   * windows open asks once per window with unsaved work.
   */
  async installCloseGuard(guard: CloseGuard): Promise<void> {
    const appWindow = getCurrentWindow();
    await appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      let mayClose = false;
      try {
        mayClose = await guard.confirmClose();
      } catch (e) {
        // A failing gate must not trap the user in the app, but it must not
        // discard their work either: keep the window open and surface it.
        console.error('[close-guard] gate failed, keeping the window open:', e);
        return;
      }
      if (!mayClose) return;
      try {
        // destroy() closes without re-emitting this event; close() would
        // come straight back here and ask the user a second time.
        await appWindow.destroy();
      } catch (e) {
        // The window stays open, which is the safe direction — the user's
        // work is still in the editor and they can close again.
        console.error('[close-guard] closing the window failed:', e);
      }
    });
  }

  async readBinary(path: string): Promise<Uint8Array> {
    return await readFile(path);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const dir = dirname(path);
    if (dir) {
      await fsMkdir(dir, { recursive: true }).catch((e: unknown) => {
        console.warn('mkdir failed:', dir, e);
      });
    }
    await writeFile(path, data);
  }

  async exists(path: string): Promise<boolean> {
    return await fsExists(path);
  }

  async listDir(path: string): Promise<FileEntry[]> {
    const entries = await readDir(path);
    return entries.map((e) => {
      const name = e.name ?? '';
      return {
        name,
        path: joinPath(path, name),
        isDirectory: e.isDirectory ?? false,
      };
    });
  }

  async mkdir(path: string): Promise<void> {
    await fsMkdir(path, { recursive: true });
  }

  async remove(path: string): Promise<void> {
    await fsRemove(path, { recursive: true });
  }

  async openWithSystem(path: string): Promise<void> {
    await shellOpen(path);
  }
}
