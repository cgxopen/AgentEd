import { isTauri } from './detect';
import type { PlatformIO, WindowControls } from './types';

export type { FileEntry, FileResult, PlatformIO, WindowControls } from './types';

let _io: PlatformIO | null = null;

export async function getPlatformIO(): Promise<PlatformIO> {
  if (_io) return _io;

  // Through `detect.ts`, which calls itself the single source of truth
  // for this question and now is one. This line used to write the same
  // expression out again.
  //
  // **Safe because the two are evaluated at different moments and give
  // the same answer**, which is a property of the environment rather
  // than of this file: `isTauri` is fixed when `detect.ts` loads, and
  // this ran when `getPlatformIO` was first called. Two shipped desktop
  // features already depend on the earlier moment — `image-loader.ts`
  // resolves a document's images only when `isTauri`, and
  // `file-association.ts` installs its listener only when `isTauri` —
  // and both work on the desktop. If the global arrived after the
  // modules loaded, those would be silently dead instead.
  if (isTauri) {
    const { TauriIO } = await import('./tauri');
    _io = new TauriIO();
  } else {
    const { WebIO } = await import('./web');
    _io = new WebIO();
  }

  return _io;
}

/**
 * Ask the user to grant a folder, and say whether one was given (#184).
 *
 * **A function here rather than a member on `PlatformIO`**, decided by
 * the owner on 2026-08-30. Both capability members that interface has
 * are recorded as debt, and a third that can never be called on the
 * desktop is the shape both went wrong in. The objection — that a
 * runtime check is a convention, and #149 established that conventions
 * break silently — is answered by the address: this is the module that
 * already owns the dynamic-import split and the singleton, not a
 * convention floating free.
 *
 * `false` on the desktop, where nothing calls it: the offer is drawn
 * only where a panel is absent for want of a grant, which is the web.
 * `false` also for a cancelled picker, so a caller cannot tell a
 * cancellation from a platform that does not ask — and does not need
 * to, since both mean *nothing changed, say nothing* (#61).
 *
 * The `await` chain is deliberately this short. `showDirectoryPicker`
 * needs transient user activation, the caller is a click, and between
 * the two there is one cached singleton and no I/O.
 */
export async function requestFolderAccess(): Promise<boolean> {
  const io = await getPlatformIO();
  const grantable = io as Partial<{ requestFolderAccess(): Promise<boolean> }>;
  if (typeof grantable.requestFolderAccess !== 'function') return false;
  return await grantable.requestFolderAccess();
}

/**
 * The controls of the window frame this build draws itself, or `null` where
 * it draws none (#366).
 *
 * **Which of the two is the window's answer**, `isDecorated()` in
 * `tauri.ts`: the native title bar is off on Windows alone, by config, and a
 * frame is drawn exactly where there is none. `isTauri` below answers only the
 * question it owns - whether there is a desktop window to ask at all - since a
 * browser tab has none, and the import it guards would fail there. What would
 * replace it is a window API the web build can call; there is none.
 *
 * **A function here rather than a member on `PlatformIO`**, the shape of
 * `requestFolderAccess` above: a capability one target has does not belong in
 * an interface every target implements.
 */
export async function ownWindowFrame(): Promise<WindowControls | null> {
  if (!isTauri) return null;
  const { ownWindowFrame: own } = await import('./tauri');
  return await own();
}

/** The name every desktop bundle installs its third-party notices under (#475, #540). */
export const THIRD_PARTY_NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt';

/**
 * The name of the third-party notices file installed with this build, or
 * `null` where nothing installed one (#475).
 *
 * The file ships through `bundle.resources`: `src-tauri/tauri.conf.json`
 * names it for Windows, and `tauri.macos.conf.json` installs the macOS file
 * under the same name (#540). So it is among the resources of the desktop
 * build and nowhere else: the web build is served from `dist/` and carries
 * no notices file. `isTauri`
 * answers only that question, which build this is. What would replace it is
 * a value the bundler hands the page at build time naming what it installed;
 * there is none.
 */
export function thirdPartyNoticesFile(): string | null {
  return isTauri ? THIRD_PARTY_NOTICES_FILE : null;
}
