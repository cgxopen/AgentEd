import { getPlatformIO } from '../platform/index';
import { basename } from '../platform/paths';
import type { AppContext } from './context';

/**
 * Build the `requestSaveAs` entry point — the single async function that
 * runs the file picker and commits the chosen path to AppState.
 *
 * Every document is a plain `.md` file, so the filename carries no
 * layout meaning: the picked path becomes the document path and the
 * caller writes the markdown to it.
 *
 * Caller receives the final path or `null` if the picker was cancelled.
 */
export function createRequestSaveAs(ctx: AppContext): () => Promise<string | null> {
  return async function requestSaveAs(): Promise<string | null> {
    const io = await getPlatformIO();
    const path = await io.saveFileAs('', 'Markdown', ['md']);
    if (!path) return null;
    ctx.state.filePath = path;
    ctx.setFilename(basename(path), path);
    ctx.state.isFirstSave = false;
    ctx.state.setModified(false);
    return path;
  };
}
