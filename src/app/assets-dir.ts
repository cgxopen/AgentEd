import { dirname, joinPath } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { showConfirmDialog } from '../ui/confirm-dialog';
import type { AppState } from './state';

export interface AssetsDirInfo {
  /** Canonical assets/ path on disk for this document. */
  readonly dir: string;
  /** Whether the directory currently exists. */
  readonly exists: boolean;
}

/**
 * Pick the canonical `assets/` directory for the document at `filePath`:
 * `assets/` next to the file (R-C5), whatever the document is called and
 * whatever else lives around it.
 *
 * Returns `null` when the path is unusable (no parent directory) — the
 * caller should bail out gracefully (e.g. require the user to Save As
 * first). Returning `{ dir, exists: false }` means the directory is a
 * valid candidate but doesn't exist yet; the caller can prompt to
 * create it.
 */
export async function resolveAssetsDir(
  filePath: string,
  io: PlatformIO,
): Promise<AssetsDirInfo | null> {
  const parent = dirname(filePath);
  // Reject empty parent (bare filename) and the filesystem root —
  // mkdir('/assets') is permission-denied on Linux and meaningless on
  // Windows / macOS.
  if (parent.length === 0 || parent === '/') return null;
  const dir = joinPath(parent, 'assets');
  return { dir, exists: await io.exists(dir) };
}

/**
 * Resolve the assets/ directory for the current document, asking the user
 * to agree to creating it if it is missing. Returns the directory path
 * once the user has agreed (or it already exists), and `null` if the user
 * declined or the path is unusable.
 *
 * **Nothing is created here (#14).** The folder is created by the save
 * flow, next to the write it guards, so that inserting an image into a
 * document that never reaches disk leaves nothing behind — "never claims
 * ownership of your folders" (R-C5) read strictly. What stays here is the
 * *consent*: asking at insert time, before the user has committed to the
 * image, is a far better moment than asking mid-save.
 *
 * The answer is remembered per folder, so the question is asked once
 * however many images the user inserts before saving — and asked again
 * only if a Save As moves the document somewhere new, which is a folder
 * the user has not agreed to yet. A refusal is equally sticky: further
 * inserts into that folder are silently dropped. Closing or opening
 * another document clears both.
 */
export async function confirmAssetsDir(
  filePath: string,
  io: PlatformIO,
  state: AppState,
): Promise<string | null> {
  const info = await resolveAssetsDir(filePath, io);
  if (!info) return null;
  if (info.exists) return info.dir;

  // Already settled for this folder — do not ask a second time.
  if (state.assetsDirConfirmedFor === info.dir) return info.dir;
  if (state.assetsDirDeclinedFor === info.dir) return null;

  const choice = await showConfirmDialog<'create' | 'cancel'>({
    title: 'Create assets folder?',
    message:
      'AgentEd needs an assets/ folder next to this file to save pasted images. ' +
      'It will be created when you save the document. Continue?',
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Continue', value: 'create', variant: 'primary' },
    ],
    defaultAction: 'create',
  });

  if (choice !== 'create') {
    state.assetsDirDeclinedFor = info.dir;
    return null;
  }

  state.assetsDirConfirmedFor = info.dir;
  return info.dir;
}
