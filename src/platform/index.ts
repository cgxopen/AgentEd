import { isTauri } from './detect';
import type { PlatformIO, TitleBarOverlay, WindowControls } from './types';

export type { FileEntry, FileResult, PlatformIO, TitleBarOverlay, WindowControls } from './types';

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

/**
 * The window whose system buttons stand over the header, or `null` where the
 * title bar is drawn apart from the content (#615).
 *
 * **The window answers**, from the config it was built from, through
 * `titleBarOverlay()` in `tauri.ts`: macOS sets the overlay style in
 * `tauri.macos.conf.json`, and no other target does. `isTauri` answers only
 * whether there is a window to ask, as for `ownWindowFrame` above; the web
 * build has none and answers `null`.
 */
export async function titleBarOverlay(): Promise<TitleBarOverlay | null> {
  if (!isTauri) return null;
  const { titleBarOverlay: overlay } = await import('./tauri');
  return await overlay();
}

/**
 * Tell the process the theme is applied, so a window created hidden is shown
 * now: on Windows the main window (#639) and on macOS every window (#645) is
 * hidden until this arrives, or until the fallback of
 * `src-tauri/src/window_shown.rs` shows it after 2 s. On Linux the window is
 * visible already and the command changes nothing.
 * `isTauri` answers only whether there is a process to tell; the web build
 * has none.
 */
export async function showWindowOnceThemed(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('show_window_themed');
}

/**
 * Tell the process the colour of the page, `--bg`, so the next window it
 * shows is drawn in it before its page paints (#645, #648): on macOS and
 * Linux the process keeps it, `src-tauri/src/window_background.rs`, and on
 * Windows it is answered and changes nothing. `isTauri` answers only whether
 * there is a process to tell; the web build has none.
 */
export async function keepPageColour(colour: string): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('keep_page_colour', { colour });
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

/**
 * Open the third-party notices this build installed, with the default
 * application of the system (#549). `none` where nothing installed one, the
 * web build, which is the answer `thirdPartyNoticesFile` gives there too;
 * `missing` where the build should hold the file and does not. A failure of
 * the system to open it is thrown.
 */
export async function openThirdPartyNotices(): Promise<'opened' | 'missing' | 'none'> {
  const name = thirdPartyNoticesFile();
  if (name === null) return 'none';
  const { openResourceWithSystem } = await import('./tauri');
  return await openResourceWithSystem(name);
}
