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
 * Resolve the assets/ directory for the current document, prompting the
 * user to create it if missing. Returns the directory path on success or
 * `null` if the user cancelled or the path is unusable.
 *
 * The user's "Cancel" choice is sticky for the current document session
 * (`state.assetsDirCreationDeclined`); subsequent paste attempts within
 * the same session are silently dropped. Closing or opening another
 * document clears the flag.
 */
export async function ensureAssetsDir(
  filePath: string,
  io: PlatformIO,
  state: AppState,
): Promise<string | null> {
  const info = await resolveAssetsDir(filePath, io);
  if (!info) return null;
  if (info.exists) return info.dir;

  if (state.assetsDirCreationDeclined) return null;

  const choice = await showConfirmDialog<'create' | 'cancel'>({
    title: 'Create assets folder?',
    message:
      'AgentEd needs an assets/ folder next to this file to save pasted images. Create it now?',
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Create', value: 'create', variant: 'primary' },
    ],
    defaultAction: 'create',
  });

  if (choice !== 'create') {
    state.assetsDirCreationDeclined = true;
    return null;
  }

  try {
    await io.mkdir(info.dir);
    return info.dir;
  } catch (e) {
    console.error('[assets-dir] mkdir failed:', e);
    return null;
  }
}
