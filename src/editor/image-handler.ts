import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isTauri } from '../platform/detect';
import { getPlatformIO } from '../platform/index';
import { basename, joinPath } from '../platform/paths';
import { bytesEqual, findIdenticalImage, findNameAmong } from './image-dedup';
import type { ReportImageInsert } from './image-insert-outcome';
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
  report: ReportImageInsert,
): Promise<void> {
  if (file.size > MAX_IMAGE_SIZE) {
    report({
      kind: 'refused',
      reason: 'too-large',
      sizeBytes: file.size,
      limitBytes: MAX_IMAGE_SIZE,
    });
    return;
  }

  // Need a file path before we can decide where assets/ goes.
  if (isTauri && !getFilePath()) {
    const saved = await requestSaveAs();
    if (!saved) {
      report({ kind: 'cancelled', at: 'destination' });
      return;
    }
  }

  // Settle where assets/ will go, and get the user's agreement to create
  // it if it is not there yet — asked here, before the image is placed,
  // even though the folder itself only appears on save (#14).
  const assetsDir = await confirmAssetsDir();
  if (!assetsDir) {
    // A cancellation, because that is what it is today: the user declined
    // the folder, now or earlier in this document session, and the answer
    // is sticky (R-C5). Two other causes reach this same null and are
    // *not* cancellations — a decline remembered from another document
    // (#51) and a web build that never asks (#46). Neither is fixed here;
    // both become a new outcome kind on this contract, which the app
    // layer then has to word before it compiles.
    report({ kind: 'cancelled', at: 'assets-folder' });
    return;
  }

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
    report({ kind: 'inserted' });
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
    report({ kind: 'refused', reason: 'no-free-name' });
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

  // The image is in the document and nothing is on disk. Reported last, so
  // no cue is raised for an insert that bailed out above — and after the
  // assets/ dialog rather than under it.
  report({ kind: 'inserted' });
}

function getImagesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (file.type.startsWith('image/')) files.push(file);
  }
  return files;
}

/**
 * One report per file, for a drop or paste carrying several of them.
 *
 * Deliberate, and deliberately unchanged: today three oversized files
 * produce three messages, and #61 is a structural change that must move
 * nothing the user sees. Batching them into one is now a change in a
 * single app-layer function rather than in this loop — which is the point
 * of the contract, not a licence to use it here.
 */
export function createImageDropPlugin(
  editor: Editor,
  getFilePath: GetFilePath,
  requestSaveAs: RequestSaveAs,
  confirmAssetsDir: ConfirmAssetsDir,
  report: ReportImageInsert,
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
            report,
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
            report,
          ).catch(console.error);
        }
        return true;
      },
    },
  });
}
