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
 * An **agreement belongs to the folder, and outlives the document that
 * won it** (#51, owner decision 2026-08-24). It is asked once however
 * many images go in before the first save, and once however many
 * documents in that folder the user edits afterwards: the folder is
 * what was agreed to, and re-asking for the file beside it reads as the
 * application forgetting what it was told. Nothing that replaces the
 * document clears it — **New, New from Template and Close** all reach
 * `resetDocument` through `clearDocumentForReplacement`, and it
 * deliberately leaves this field alone; **Open** never went through
 * `resetDocument` in the first place. That is the whole list, and it is
 * the whole list on purpose.
 *
 * It is asked again in exactly two cases, both of them honest: a Save
 * As that moves the document to a folder not yet agreed to — a
 * different folder is a different question, which falls out of keying
 * on the directory — and a new window, since R-C8 gives each window its
 * own state. That window is the whole lifetime of the answer; nothing
 * is written to disk about it.
 *
 * A **refusal is not remembered** (#66). It cancels the image it was
 * asked about, and the next insert asks again — exactly like cancelling
 * the destination picker one gesture earlier. The asymmetry is
 * deliberate: remembering a yes spares the user a repeated dialog, while
 * remembering a no silently disabled images for the rest of the
 * document, with no way to change the answer.
 */
export async function confirmAssetsDir(
  filePath: string,
  io: PlatformIO,
  state: AppState,
): Promise<string | null> {
  const info = await resolveAssetsDir(filePath, io);
  if (!info) return null;
  if (info.exists) return info.dir;

  // Already agreed for this folder — do not ask a second time.
  if (state.assetsDirConfirmedFor === info.dir) return info.dir;

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

  // Nothing is recorded on a refusal: this image is cancelled, the next
  // one asks again (#66).
  if (choice !== 'create') return null;

  state.assetsDirConfirmedFor = info.dir;
  return info.dir;
}
