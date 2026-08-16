import type { Editor } from '@tiptap/core';
import { normalizeLinkUrl } from '../editor/link-url';

/**
 * The link dialog (#25) — one field, because a link is one decision.
 *
 * Three situations, one dialog:
 *
 *   - **Text selected** → the selection becomes the link text; the dialog only
 *     asks where it points.
 *   - **Caret inside a link** → opens pre-filled, and offers Remove. A link you
 *     cannot unmake is a trap.
 *   - **Nothing selected** → the address becomes its own visible text. No
 *     second field: a dialog with two inputs is a form, and this is a control.
 *
 * Escape cancels and changes nothing. An empty address on an existing link is
 * the same as Remove. Anything unusable is refused quietly — the dialog stays
 * open with the text still there, rather than lecturing about syntax.
 */
export interface LinkDialog {
  open: () => void;
}

export function setupLinkDialog(editor: Editor): LinkDialog {
  const dialog = document.getElementById('link-dialog')!;
  const input = document.getElementById('link-url') as HTMLInputElement;
  const removeButton = document.getElementById('link-remove') as HTMLButtonElement;

  function close(): void {
    dialog.classList.add('hidden');
    editor.chain().focus().run();
  }

  function removeLink(): void {
    close();
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
  }

  function confirm(): void {
    const raw = input.value;
    const onLink = editor.isActive('link');

    // Emptying the field on an existing link means "unmake it".
    if (raw.trim() === '' && onLink) {
      removeLink();
      return;
    }

    const href = normalizeLinkUrl(raw);
    if (href === null) {
      // Refused quietly: nothing is inserted and the dialog stays put, so a
      // typo is one keystroke from being fixed rather than from being redone.
      input.select();
      return;
    }

    close();

    if (editor.state.selection.empty && !onLink) {
      // No selection: the address is its own text.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run();
      return;
    }

    // With the caret inside a link and no selection, extendMarkRange covers the
    // whole link, so changing the address rewrites that link rather than
    // splitting it.
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }

  document.getElementById('link-confirm')!.addEventListener('click', confirm);
  document.getElementById('link-cancel')!.addEventListener('click', close);
  removeButton.addEventListener('click', removeLink);

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
    const existing = editor.getAttributes('link').href as string | undefined;
    input.value = existing ?? '';
    removeButton.classList.toggle('hidden', !editor.isActive('link'));
    dialog.classList.remove('hidden');
    input.focus();
    input.select();
  }

  return { open };
}
