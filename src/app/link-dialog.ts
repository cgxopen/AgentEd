import type { Editor } from '@tiptap/core';
import { NodeSelection, type Selection } from '@tiptap/pm/state';
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
 * the same as Remove. Anything unusable is refused *with a reason*: the dialog
 * stays open, the text stays put, and one line says what would be accepted —
 * a refusal that explains nothing reads as a broken application, which is the
 * same finding as #13.
 */

/** Why an address was refused. One line each, no syntax lecture. */
const NEEDS_ADDRESS = 'Enter an address, or press Escape to cancel.';
const UNSUPPORTED_ADDRESS =
  'Use a web address (https://…), an email address (mailto:…), or a relative path (./notes.md).';
export interface LinkDialog {
  open: () => void;
}

export function setupLinkDialog(editor: Editor): LinkDialog {
  const dialog = document.getElementById('link-dialog')!;
  const input = document.getElementById('link-url') as HTMLInputElement;
  const removeButton = document.getElementById('link-remove') as HTMLButtonElement;
  const errorEl = document.getElementById('link-error')!;

  function showError(message: string): void {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function clearError(): void {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }

  function close(): void {
    clearError();
    dialog.classList.add('hidden');
    editor.chain().focus().run();
  }

  function removeLink(): void {
    close();
    editor.chain().focus().extendMarkRange('link', editor.getAttributes('link')).unsetLink().run();
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
      // Nothing is inserted and the dialog stays put, so a typo is one
      // keystroke from being fixed rather than from being retyped.
      showError(raw.trim() === '' ? NEEDS_ADDRESS : UNSUPPORTED_ADDRESS);
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
    // splitting it. It is asked for the link under the caret, attributes and
    // all, so a link beside it with the same address and another place is not
    // taken with it (#565, D5).
    editor
      .chain()
      .focus()
      .extendMarkRange('link', editor.getAttributes('link'))
      .setLink({ href })
      .run();
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

  // Typing is an attempt at a correction; the complaint about the old value
  // should not outlive it.
  input.addEventListener('input', clearError);

  function open(): void {
    // Every door reaches here - the toolbar button, Ctrl+K and Insert, Link -
    // so this is where a place that cannot take a link is refused (#20), the
    // way #427 refused at the command rather than at the bar. The entry greys
    // and the bar leaves its button out; Ctrl+K has nothing to show, so it
    // does nothing.
    if (!canMakeLink(editor.state.selection)) return;
    clearError();
    const existing = editor.getAttributes('link').href as string | undefined;
    input.value = existing ?? '';
    removeButton.classList.toggle('hidden', !editor.isActive('link'));
    dialog.classList.remove('hidden');
    input.focus();
    input.select();
  }

  return { open };
}

/** The key the Insert menu reads the Link entry's availability from (#450). */
export const INSERT_LINK_KEY = 'insertLink';

/**
 * Whether the link dialog can make a link where the selection is (#450).
 *
 * Measured at step zero by confirming the dialog with an address in each
 * place, rather than reasoned:
 *
 *   - **Inside a fenced block it cannot.** With the caret there the address
 *     was inserted as plain code text, and with text selected nothing changed:
 *     a code block takes no marks. Either end of the selection inside one is
 *     enough, since that end is where nothing can be linked.
 *   - **On a selected horizontal rule it cannot**: nothing changed. A rule is
 *     a block node and a link is a mark on inline content.
 *   - **On a selected image it can**, and wrote `[![alt](i.png)](url)`, a
 *     linked image, which is legitimate markdown. Inside an inline code span
 *     it can too: a link at the caret, or around the selected code.
 *   - **Over the whole document it can**, and links the text of every block
 *     with the one address. Ctrl+K does the same there; the entry is not the
 *     place to decide otherwise.
 *
 * Read by the Insert menu when it opens, the rule of #292: an entry with
 * nothing to do is greyed rather than silent. Since #20 it is also what the
 * dialog asks before it opens, so Ctrl+K does nothing in those places where
 * it used to put the address into the fenced block as code text, and what the
 * toolbar asks before it draws the link button.
 */
export function canMakeLink(selection: Selection): boolean {
  if (selection instanceof NodeSelection && !selection.node.isInline) return false;
  const inCode = selection.$from.parent.type.spec.code === true;
  return !(inCode || selection.$to.parent.type.spec.code === true);
}

/** The Link entry's availability, keyed for the Insert menu. */
export function linkAvailability(editor: Editor): Readonly<Record<string, boolean>> {
  return { [INSERT_LINK_KEY]: canMakeLink(editor.state.selection) };
}
