import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isTauri } from '../platform/detect';
import { getPlatformIO } from '../platform/index';
import { basename, joinPath } from '../platform/paths';
import { showToast } from '../ui/toast';
import { bytesEqual, findIdenticalImage, findNameAmong } from './image-dedup';
import { buildImageName, type ImageOrigin, keptFileName } from './image-names';
import { getAllImages, getDisplayUrl, registerImage } from './image-registry';

export type GetFilePath = () => string | null;
export type RequestSaveAs = () => Promise<string | null>;

/**
 * Resolves the assets/ folder for the current document, asking the user
 * to agree to its creation when it does not exist yet. Returns `null`
 * when the user declines or there is no usable path. It does **not**
 * create the folder — the save flow does that (#14).
 */
export type ConfirmAssetsDir = () => Promise<string | null>;

/**
 * Called once the image is in the document — the insert's only success
 * signal, and the moment nothing has been written yet (#48). A cancelled
 * insert, at either dialog, never reaches it. What to say about that is
 * the app layer's business (`src/app/destination-cue.ts`); this module
 * only reports that it happened.
 */
export type OnImageInserted = () => void;

// Reject paste/drop of images past this size to prevent OOM. file.arrayBuffer()
// allocates the whole buffer up front, and the registry then keeps a copy alive
// as a Blob, so peak usage is ~2× the file size. 25 MB covers normal screenshots
// and design exports while keeping a comfortable memory ceiling.
export const MAX_IMAGE_SIZE = 25 * 1024 * 1024;

interface TakenNames {
  /** Names present in the assets folder on disk. */
  readonly onDisk: Set<string>;
  /** Everything a new name must avoid: what is on disk plus this session's claims. */
  readonly all: Set<string>;
}

/**
 * Every name already spoken for in the assets folder: what is on disk, plus
 * what this session has claimed but not yet written. Nothing may be
 * overwritten, so a folder we cannot read still yields the session's names
 * rather than an empty set (R-C5).
 *
 * The two are kept apart because only a name that is genuinely *on disk*
 * has a file behind it to compare bytes against (#52); a name this session
 * claimed has already been compared, in memory, by `findIdenticalImage`.
 */
async function takenNames(assetsDir: string): Promise<TakenNames> {
  const onDisk = new Set<string>();
  const all = new Set<string>();
  for (const image of getAllImages()) all.add(basename(image.relativePath));
  try {
    const io = await getPlatformIO();
    for (const entry of await io.listDir(assetsDir)) {
      if (entry.isDirectory) continue;
      onDisk.add(entry.name);
      all.add(entry.name);
    }
  } catch (e) {
    console.warn('[agented] could not read the assets folder for naming:', e);
  }
  return { onDisk, all };
}

/**
 * The name to reuse when the file this image wants to be is already in the
 * assets folder and holds exactly these bytes — the same picture inserted
 * again in a later session (#52).
 *
 * Null when the bytes differ, which is a genuine collision and keeps its
 * numeric suffix, and null when the file cannot be read: an unreadable
 * neighbour is never grounds for assuming a match. Costs one read, only on
 * a name collision, and never a scan.
 */
async function fileAlreadyInAssets(
  assetsDir: string,
  sourceName: string,
  origin: ImageOrigin,
  data: Uint8Array,
  onDisk: ReadonlySet<string>,
): Promise<string | null> {
  const wanted = keptFileName(sourceName, origin);
  if (!wanted) return null;
  const match = findNameAmong(wanted, onDisk);
  if (!match) return null;

  try {
    const io = await getPlatformIO();
    const existing = await io.readBinary(joinPath(assetsDir, match));
    return bytesEqual(existing, data) ? match : null;
  } catch (e) {
    console.warn('[agented] could not read an assets file to compare it:', e);
    return null;
  }
}

/**
 * Insert one image file into the document (R-C5). Any document can
 * receive images at any time — there is no document kind to check.
 */
export async function handleImageFile(
  file: File,
  editor: Editor,
  getFilePath: GetFilePath,
  requestSaveAs: RequestSaveAs,
  confirmAssetsDir: ConfirmAssetsDir,
  origin: ImageOrigin,
  onInserted: OnImageInserted = () => {},
): Promise<void> {
  if (file.size > MAX_IMAGE_SIZE) {
    const sizeMb = Math.round(file.size / 1024 / 1024);
    const limitMb = MAX_IMAGE_SIZE / 1024 / 1024;
    showToast(`Image too large (${sizeMb} MB). Max ${limitMb} MB.`, 'warn');
    return;
  }

  // Need a file path before we can decide where assets/ goes.
  if (isTauri && !getFilePath()) {
    const saved = await requestSaveAs();
    if (!saved) return;
  }

  // Settle where assets/ will go, and get the user's agreement to create
  // it if it is not there yet — asked here, before the image is placed,
  // even though the folder itself only appears on save (#14). Cancelled
  // by the user → silently no-op for the rest of this document session.
  const assetsDir = await confirmAssetsDir();
  if (!assetsDir) return;

  // Read the bytes before allocating anything: they are what decides
  // whether this document already has this picture (#52).
  const data = new Uint8Array(await file.arrayBuffer());

  // Already inserted in this document → point at the same file instead of
  // storing a second copy of it. Costs no I/O, and skips the naming step
  // entirely.
  const identical = findIdenticalImage(data, getAllImages());
  const identicalUrl = identical ? getDisplayUrl(identical.relativePath) : undefined;
  if (identicalUrl) {
    editor.chain().focus().setImage({ src: identicalUrl, alt: file.name }).run();
    onInserted();
    return;
  }

  const taken = await takenNames(assetsDir);

  // Or already in assets/ from an earlier session, under the very name
  // this one wants.
  const reused = await fileAlreadyInAssets(assetsDir, file.name, origin, data, taken.onDisk);

  const documentPath = getFilePath();
  const filename =
    reused ??
    buildImageName({
      sourceName: file.name,
      documentName: documentPath ? basename(documentPath) : null,
      taken: taken.all,
      origin,
    });
  if (!filename) {
    // Only reachable with a thousand taken variants of the same name;
    // refusing beats overwriting one of them (R-C5).
    showToast('Could not find a free file name in the assets folder.', 'warn');
    return;
  }

  // Convention: relativePath is always assets/<filename>. Save flow
  // resolves the absolute path against the document's own folder.
  const relativePath = `assets/${filename}`;

  // Use blob URLs universally for display (both Tauri and Web)
  // No eager disk write — save is the single source of truth
  const displayUrl = URL.createObjectURL(new Blob([data.slice().buffer as ArrayBuffer]));
  registerImage(displayUrl, { relativePath, data, filename: file.name });

  editor.chain().focus().setImage({ src: displayUrl, alt: file.name }).run();

  // The image is in the document and nothing is on disk. Notify last, so
  // no cue is raised for an insert that bailed out above — and after the
  // assets/ dialog rather than under it.
  onInserted();
}

function getImagesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (file.type.startsWith('image/')) files.push(file);
  }
  return files;
}

export function createImageDropPlugin(
  editor: Editor,
  getFilePath: GetFilePath,
  requestSaveAs: RequestSaveAs,
  confirmAssetsDir: ConfirmAssetsDir,
  onInserted: OnImageInserted = () => {},
): Plugin {
  return new Plugin({
    key: new PluginKey('imageDropHandler'),
    props: {
      handleDrop(_view: EditorView, event: DragEvent) {
        if (!event.dataTransfer) return false;
        const images = getImagesFromDataTransfer(event.dataTransfer);
        if (images.length === 0) return false;
        event.preventDefault();
        for (const file of images) {
          // A dropped file brings its own name (R-C5).
          void handleImageFile(
            file,
            editor,
            getFilePath,
            requestSaveAs,
            confirmAssetsDir,
            'file',
            onInserted,
          ).catch(console.error);
        }
        return true;
      },
      handlePaste(_view: EditorView, event: ClipboardEvent) {
        if (!event.clipboardData) return false;
        const images = getImagesFromDataTransfer(event.clipboardData);
        if (images.length === 0) return false;
        event.preventDefault();
        for (const file of images) {
          void handleImageFile(
            file,
            editor,
            getFilePath,
            requestSaveAs,
            confirmAssetsDir,
            'clipboard',
            onInserted,
          ).catch(console.error);
        }
        return true;
      },
    },
  });
}
