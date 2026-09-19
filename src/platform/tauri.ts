import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  exists as fsExists,
  mkdir as fsMkdir,
  readDir,
  readFile,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { loadLastOpenedFolder } from '../preferences';
import { decodeFileText } from './decode';
import { basename, dirname, joinPath } from './paths';
import type {
  CloseGuard,
  EntryPresence,
  FileEntry,
  FileResult,
  FileSnapshot,
  PickedFile,
  PlatformIO,
  WindowControls,
} from './types';

export class TauriIO implements PlatformIO {
  readonly supportsMultiFile = true;
  readonly pathsOutliveSession = true;

  /**
   * Always, for any document whose path carries a directory — which on
   * this platform is every document, since the OS pickers return absolute
   * paths.
   *
   * The two rejections are the ones `resolveAssetsDir` used to make in the
   * app layer (#46). They are facts about desktop paths, so they live
   * here: a bare name has no parent to put `assets/` beside, and the
   * filesystem root is not somewhere AgentEd creates folders — `mkdir
   * ('/assets')` is permission-denied on Linux and meaningless elsewhere.
   */
  async canWriteCompanions(documentPath: string): Promise<boolean> {
    const parent = dirname(documentPath);
    return parent.length > 0 && parent !== '/';
  }

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
    const content = decodeFileText(await readFile(filePath), filePath);
    return { content, path: filePath };
  }

  async pickFile(filterName: string, extensions: string[]): Promise<PickedFile | null> {
    const lastFolder = loadLastOpenedFolder();
    const selected = await open({
      multiple: false,
      filters: [{ name: filterName, extensions }],
      ...(lastFolder ? { defaultPath: lastFolder } : {}),
    });
    const path = (selected as string | null) ?? null;
    if (path === null) return null;
    // The desktop reference is a real path, so the name is its last
    // segment — which is what the caller used to compute for itself, and
    // computed correctly here and wrongly on the web (#145). It is taken
    // here now, where the shape of the value is known.
    return { ref: path, name: basename(path) };
  }

  async readText(path: string): Promise<string> {
    // Bytes, then this application's own decoder. `readTextFile` decodes
    // with a `TextDecoder` it does not let the caller configure, which is
    // lossy and strips the mark (#259).
    return decodeFileText(await readFile(path), path);
  }

  async saveFile(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
  }

  /**
   * Read the file as it is on disk right now (R-C14). The read is
   * attempted first and `exists` only consulted to explain a failure, so
   * the ordinary case costs one call rather than two — and a file that
   * disappeared between the two is reported as unreadable, which is the
   * cautious direction.
   */
  async readSnapshot(path: string): Promise<FileSnapshot> {
    try {
      return { kind: 'file', text: decodeFileText(await readFile(path), path) };
    } catch (e) {
      try {
        if (!(await fsExists(path))) return { kind: 'absent' };
      } catch {
        // Fall through: we could not read it and cannot say why.
      }
      return { kind: 'unreadable', cause: e };
    }
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

  /**
   * `fsExists` answers the two ordinary states; anything it raises is
   * the third (#126). Nothing here reads the text of that error — on
   * this platform it is written by the operating system and translated
   * into its language, so a check that read it would work in one locale
   * and fail silently in the next (#58).
   */
  async entryPresence(path: string): Promise<EntryPresence> {
    try {
      return (await fsExists(path)) ? 'present' : 'absent';
    } catch (e) {
      console.warn('[agented] could not tell whether a path is there:', path, e);
      return 'unknown';
    }
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

  async openWithSystem(path: string): Promise<void> {
    await shellOpen(path);
  }
}

/**
 * The controls of a window whose frame AgentEd draws itself, or `null` when
 * the system draws one (#366).
 *
 * **The window answers, not the platform name.** On Windows the build turns
 * the native title bar off, in `tauri.windows.conf.json`; on Linux and macOS
 * it keeps it. `isDecorated()` is the fact that follows from that config, so a
 * target that changes its config changes this answer with it.
 *
 * `close` is `close()`, never `destroy()`: `close()` raises the close request
 * `installCloseGuard` above listens to, so the unsaved-changes gate asks, as it
 * does for the system button and Alt+F4 (R-C3).
 */
export async function ownWindowFrame(): Promise<WindowControls | null> {
  const appWindow = getCurrentWindow();
  if (await appWindow.isDecorated()) return null;
  return {
    minimize: () => appWindow.minimize(),
    toggleMaximize: () => appWindow.toggleMaximize(),
    close: () => appWindow.close(),
  };
}
