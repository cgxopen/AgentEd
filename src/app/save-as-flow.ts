import { getPlatformIO } from '../platform/index';
import { basename } from '../platform/paths';
import type { AppContext } from './context';

/**
 * Build the `requestSaveAs` entry point — the single async function that
 * asks the user where the document should live and commits that path to
 * AppState.
 *
 * Choosing a destination is **not** a save: nothing is written here, and
 * the document stays modified until a save actually succeeds (R-C3).
 * `persistBundle` writes the bytes and clears the modified flag; leaving
 * it set here is what makes a cancelled or failed save still prompt at
 * close time instead of quietly dropping the work.
 *
 * Caller receives the chosen path or `null` if the picker was cancelled.
 */
export function createRequestSaveAs(ctx: AppContext): () => Promise<string | null> {
  return async function requestSaveAs(): Promise<string | null> {
    const io = await getPlatformIO();
    const path = await io.pickSavePath('Markdown', ['md']);
    if (!path) return null;
    ctx.state.filePath = path;
    ctx.setFilename(basename(path), path);
    return path;
  };
}
