import type { Editor } from '@tiptap/core';
import { handleImageFile } from '../editor/image-handler';
import type { ReportImageInsert } from '../editor/image-insert-outcome';
import { getPlatformIO } from '../platform/index';
import type { PickedFile } from '../platform/types';
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
  let picked: PickedFile | null = null;
  try {
    picked = await io.pickFile('Images', IMAGE_EXTENSIONS);
  } catch (e) {
    await reporter.dialog('Failed to open image picker', e);
    return;
  }
  if (!picked) return;

  try {
    // The reference finds the bytes; the name is what the file is
    // called. Both come from the platform, because only it knows the
    // shape of either (#145). This used to be one string and a
    // `basename` of it, which is a path operation applied to something
    // that is a path on one target and a registry token on the other —
    // so the web build wrote `picked-<name>` into `assets/` while the
    // desktop build wrote the name.
    const data = await io.readBinary(picked.ref);
    const filename = picked.name;
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
      // #46, and the order matters: `handleImageFile` asks this only once
      // the destination step has settled, which on web is what grants the
      // folder access it reports on.
      async () => {
        const path = state.filePath;
        if (!path) return false;
        return io.canWriteCompanions(path);
      },
      // The picked file carries the name the user knows it by (R-C5).
      'file',
      report,
    );
  } catch (e) {
    // The name, never the reference: this sentence is read by a person,
    // and on the web the reference carries a spelling that belongs to
    // the platform (#145).
    await reporter.dialog(`Failed to insert image: ${picked.name}`, e);
  }
}
