import { getPlatformIO } from '../platform/index';
import { basename, dirname, stripExtension } from '../platform/paths';
import { showToast } from '../ui/toast';
import type { AppContext } from './context';

const SAVE_AS_TIP_KEY = 'agented:save-as-layout-tip-shown';

/**
 * Build the `requestSaveAs` entry point — the single async function that
 * runs the file picker and commits the chosen path / layout to AppState.
 *
 * Filename decides layout:
 *   - `SKILL.md` (case-insensitive) → parent-as-folder (companion folder
 *     is the file's parent directory).
 *   - Anything else with `state.docFolder` already set → sibling
 *     (`stripExtension(path)/`).
 *   - Otherwise → plain markdown (no companion folder).
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
    applyLayoutFromFilename(ctx, path);
    return path;
  };
}

function applyLayoutFromFilename(ctx: AppContext, path: string): void {
  const name = basename(path).toLowerCase();
  if (name === 'skill.md') {
    ctx.state.docFolder = dirname(path);
    ctx.state.layout = 'parent-as-folder';
    return;
  }

  // Preserve sibling layout when the user previously had a companion
  // folder (e.g. saving a Structured doc to a new name); otherwise the
  // document stays plain markdown without a companion folder.
  if (ctx.state.docFolder !== null) {
    ctx.state.docFolder = stripExtension(path);
    ctx.state.layout = 'sibling';
    maybeShowSiblingLayoutTip();
    return;
  }

  ctx.state.docFolder = null;
  ctx.state.layout = null;
}

function maybeShowSiblingLayoutTip(): void {
  try {
    if (localStorage.getItem(SAVE_AS_TIP_KEY)) return;
    localStorage.setItem(SAVE_AS_TIP_KEY, '1');
  } catch {
    return;
  }
  showToast(
    'Saved as sibling layout. To create an ecosystem skill, name your ' +
      'file SKILL.md in a dedicated folder.',
    'info',
  );
}
