import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isTauri } from '../platform/detect';
import { showToast } from '../ui/toast';
import { registerImage } from './image-registry';

export type GetFilePath = () => string | null;
export type RequestSaveAs = () => Promise<string | null>;

export interface ImagePasteCheckResult {
  /** Whether the active profile permits image paste/drop. */
  allowed: boolean;
  /** User-facing reason when `allowed` is false (used for the toast). */
  reason?: string;
}

export type ImagePasteCheck = () => ImagePasteCheckResult;
/** Resolves (and creates if needed) the on-disk assets/ folder. */
export type EnsureAssetsDir = () => Promise<string | null>;

// Reject paste/drop of images past this size to prevent OOM. file.arrayBuffer()
// allocates the whole buffer up front, and the registry then keeps a copy alive
// as a Blob, so peak usage is ~2× the file size. 25 MB covers normal screenshots
// and design exports while keeping a comfortable memory ceiling.
export const MAX_IMAGE_SIZE = 25 * 1024 * 1024;

function generateFilename(file: File): string {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const ext = file.name.split('.').pop() || 'png';
  const base = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${base}-${timestamp}-${rand}.${ext}`;
}

export async function handleImageFile(
  file: File,
  editor: Editor,
  getFilePath: GetFilePath,
  requestSaveAs: RequestSaveAs,
  imagePasteCheck: ImagePasteCheck,
  ensureAssetsDir: EnsureAssetsDir,
): Promise<void> {
  const check = imagePasteCheck();
  if (!check.allowed) {
    showToast(check.reason ?? 'Image paste is not supported.', 'warn');
    return;
  }

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

  // Resolve (and possibly create) the assets/ folder. Cancelled by the
  // user → silently no-op for the rest of this document session.
  const assetsDir = await ensureAssetsDir();
  if (!assetsDir) return;

  const filename = generateFilename(file);
  const data = new Uint8Array(await file.arrayBuffer());

  // Convention: relativePath is always assets/<filename>. Save flow
  // resolves the absolute path against the document's companion folder.
  const relativePath = `assets/${filename}`;

  // Use blob URLs universally for display (both Tauri and Web)
  // No eager disk write — save is the single source of truth
  const displayUrl = URL.createObjectURL(new Blob([data.slice().buffer as ArrayBuffer]));
  registerImage(displayUrl, { relativePath, data, filename: file.name });

  editor.chain().focus().setImage({ src: displayUrl, alt: file.name }).run();
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
  imagePasteCheck: ImagePasteCheck,
  ensureAssetsDir: EnsureAssetsDir,
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
          void handleImageFile(
            file,
            editor,
            getFilePath,
            requestSaveAs,
            imagePasteCheck,
            ensureAssetsDir,
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
            imagePasteCheck,
            ensureAssetsDir,
          ).catch(console.error);
        }
        return true;
      },
    },
  });
}
