import type { PlatformIO } from './types';

export type { FileEntry, FileResult, PlatformIO } from './types';

let _io: PlatformIO | null = null;

export async function getPlatformIO(): Promise<PlatformIO> {
  if (_io) return _io;

  if ('__TAURI_INTERNALS__' in window) {
    const { TauriIO } = await import('./tauri');
    _io = new TauriIO();
  } else {
    const { WebIO } = await import('./web');
    _io = new WebIO();
  }

  return _io;
}
