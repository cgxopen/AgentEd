import type { Editor } from '@tiptap/core';
import { handleImageFile } from '../editor/image-handler';
import type { ReportImageInsert } from '../editor/image-insert-outcome';
import { getPlatformIO } from '../platform/index';
import { basename } from '../platform/paths';
import { confirmAssetsDir } from './assets-dir';
import type { ErrorReporter } from './error-reporter';
import type { AppState } from './state';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function mimeFromExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream';
}

export interface MediaPickerDeps {
  state: AppState;
  editor: Editor;
  requestSaveAs: () => Promise<string | null>;
  reporter: ErrorReporter;
  /** How the insert reports back — landed, cancelled or refused (#61). */
  report: ReportImageInsert;
}

/**
 * Menu-driven image insert: picks a file via the native dialog, reads
 * its bytes, wraps them in a `File`, then hands off to the shared image
 * insertion flow (`handleImageFile`) which also services drag/paste.
 */
export async function insertMedia(deps: MediaPickerDeps): Promise<void> {
  const { state, editor, requestSaveAs, reporter, report } = deps;

  const io = await getPlatformIO();
  let pickedPath: string | null = null;
  try {
    pickedPath = await io.pickFile('Images', IMAGE_EXTENSIONS);
  } catch (e) {
    await reporter.dialog('Failed to open image picker', e);
    return;
  }
  if (!pickedPath) return;

  try {
    const data = await io.readBinary(pickedPath);
    const filename = basename(pickedPath);
    const ext = (filename.split('.').pop() || 'png').toLowerCase();
    const mime = mimeFromExt(ext);
    const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: mime });
    const file = new File([blob], filename, { type: mime });
    await handleImageFile(
      file,
      editor,
      () => state.filePath,
      requestSaveAs,
      async () => {
        const path = state.filePath;
        if (!path) return null;
        return confirmAssetsDir(path, io, state);
      },
      // The picked file carries the name the user knows it by (R-C5).
      'file',
      report,
    );
  } catch (e) {
    await reporter.dialog(`Failed to insert image: ${pickedPath}`, e);
  }
}
