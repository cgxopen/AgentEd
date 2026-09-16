import { isTauri } from './detect';
import type { PlatformIO, WindowAppearance } from './types';

export type { FileEntry, FileResult, PlatformIO, WindowAppearance } from './types';

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
 * Ask the host window to take the appearance the palette describes (#326).
 *
 * **A function here rather than a member on `PlatformIO`**, for the reason
 * `requestFolderAccess` above is one: a window frame is a capability one target
 * has, and an interface every target implements is where that went wrong twice.
 *
 * **Nothing anywhere branches on whether it worked.** A browser tab has no
 * frame; a Windows without the mechanism keeps the system default; both are the
 * documented fallback rather than a failure, so this answers `void` and never
 * rejects.
 */
export async function applyWindowAppearance(appearance: WindowAppearance): Promise<void> {
  if (!isTauri) return;
  const { applyWindowAppearance: apply } = await import('./tauri');
  await apply(appearance);
}
