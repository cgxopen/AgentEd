import type { Editor } from '@tiptap/core';
import { imageDescription, setImageDescription } from '../editor/image-description';

/**
 * The Image description dialog (#291) — one field, because a description is
 * one decision, which is the argument R-C1 already makes for the link dialog.
 *
 * **It is the link dialog with its middle removed.** Enter confirms, Escape
 * cancels and changes nothing, the field opens with what the image carries
 * already in it and selected, and closing gives focus back to the document.
 * What it does not carry is everything that belongs to a link: no address to
 * normalize, no Remove, and **no refusal at all** — every string is a
 * description a person may mean, the empty one included (owner decision,
 * 2026-09-17).
 *
 * **The one line above the field is the point of the whole issue.** The owner
 * asked whether an ordinary person would understand what this control is for,
 * and reported forgetting himself a week after deciding on it. A tooltip long
 * enough to teach it would be too long to read, so the explaining lives where
 * the user has already stopped to type. It is the first note of its kind in
 * the product: every other line inside a dialog is a refusal.
 *
 * Nothing here is measured by the harness beyond the state it leaves behind —
 * whether the sentence does its work is the question the manual pass asks.
 */
export interface ImageDescriptionDialog {
  open: () => void;
}

/**
 * An element of the shipped page, or a boot-time error naming what is missing
 * — the shape `menu.ts` uses, so markup deleted from `index.html` is met at
 * boot rather than at the first press.
 */
function required(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`the page has no #${id}`);
  return element;
}

export function setupImageDescriptionDialog(editor: Editor): ImageDescriptionDialog {
  const dialog = required('image-description-dialog');
  const input = required('image-description-text') as HTMLInputElement;

  function close(): void {
    dialog.classList.add('hidden');
    editor.chain().focus().run();
  }

  function confirm(): void {
    const description = input.value;
    // The dialog closes first, so the selection the write needs is restored by
    // the focus below rather than fought over with a dialog that is still up.
    close();
    setImageDescription(editor, description);
  }

  required('image-description-confirm').addEventListener('click', confirm);
  required('image-description-cancel').addEventListener('click', close);

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  function open(): void {
    const existing = imageDescription(editor);
    // No image selected is not a state this dialog has: both doors to it are
    // hidden or greyed for it. Opening anyway would ask for a description
    // nothing would receive, so it does nothing at all.
    if (existing === null) return;
    input.value = existing;
    dialog.classList.remove('hidden');
    input.focus();
    input.select();
  }

  return { open };
}

/**
 * The two doors to this dialog, as the mapping from entry to command — the
 * shape `table-dialog.ts` records, so the tests drive the same object
 * `main.ts` spreads rather than a copy of it, and a handler moved onto another
 * entry reddens.
 */
export function imageDescriptionRoutes(editor: Editor): {
  readonly onImageDescription: () => void;
} {
  const { open } = setupImageDescriptionDialog(editor);
  return { onImageDescription: open };
}
