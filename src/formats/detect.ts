import { basename, dirname, joinPath, stripExtension } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import type { StructuredLayout } from './types';

export interface DocumentShape {
  layout: StructuredLayout | null;
  docFolder: string | null;
}

/**
 * Detect structured layout + companion folder from the path + IO probes.
 *
 * Precedence:
 *   1. basename(path).toLowerCase() === 'skill.md' AND parent reachable
 *      → parent-as-folder. `SKILL.md` is a convention name, not an
 *      accidental one. docFolder = dirname(path).
 *   2. Sibling folder `stripExtension(path)` contains `.agented-meta.json`,
 *      `assets/`, or legacy `attachments/` → sibling structured.
 *      docFolder = stripExtension(path).
 *   3. Otherwise → plain markdown (docFolder=null, layout=null).
 *
 * Tradeoff on rule 1: a non-skill file coincidentally named `SKILL.md`
 * (e.g. a note *about* skills) will open as structured. Accepted to
 * avoid false negatives on minimal skills with no companion folders.
 */
export async function detectDocumentShape(path: string, io: PlatformIO): Promise<DocumentShape> {
  if (basename(path).toLowerCase() === 'skill.md') {
    // Parent-as-folder requires that the parent actually be reachable by
    // the IO layer. In Tauri this is always true once the file is open.
    // In Web without a directory handle, `exists` returns false — and
    // structured mode would be non-functional there (no companion load,
    // broken multi-file save). Fall back to markdown so the user gets a
    // usable single-file flow.
    //
    // Also reject the filesystem root (`/`) as a companion folder.
    const parent = dirname(path);
    if (parent.length > 0 && parent !== '/' && (await io.exists(parent))) {
      return { layout: 'parent-as-folder', docFolder: parent };
    }
  }

  const sibling = stripExtension(path);
  const [hasMeta, hasAttach, hasAssets] = await Promise.all([
    io.exists(joinPath(sibling, '.agented-meta.json')),
    io.exists(joinPath(sibling, 'attachments')),
    io.exists(joinPath(sibling, 'assets')),
  ]);
  if (hasMeta || hasAttach || hasAssets) {
    return { layout: 'sibling', docFolder: sibling };
  }

  return { layout: null, docFolder: null };
}
