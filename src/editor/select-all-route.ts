import type { Editor } from '@tiptap/core';

/**
 * Select All, as an entry of the Edit section (#323).
 *
 * The capability already shipped as a chord and nothing in the interface named
 * it — the #295 shape, and this is the same answer Undo and Redo were given
 * there. **Nothing about the capability moves**: the chord is untouched, what a
 * selection means is untouched, and R-C16 is untouched.
 *
 * **Two routes to one operation, and the word *operation* is deliberate.**
 * Measured on `3b53ea4`: `Ctrl+A` is handled by the editor rather than by the
 * runtime — a listener on `document` sees the keydown with `defaultPrevented`
 * already true and the ProseMirror element as its target — through the base
 * keymap the StarterKit registers. The entry below reaches the same operation
 * through the command TipTap exposes for it. They are not one function, and
 * saying so is the point: what they share is the selection they produce, which
 * the rows compare rather than assume.
 *
 * **What the selection covers**, measured rather than read, on a document
 * holding all three: a table — yes; a fenced code block — yes; **the metadata
 * block — no**, because `#frontmatter-input` is not inside `.ProseMirror` and
 * no editor selection can reach it. A select-all followed by Delete therefore
 * empties the document and leaves the metadata block whole, character for
 * character, with its badge still up. That is #305 holding, and it is what the
 * chord does today.
 *
 * **One state where the press does nothing to the document, stated rather than
 * hidden**: an empty one. The selection it produces is not collapsed and
 * selects no text, and today the floating toolbar comes up over it carrying
 * eleven controls that change nothing. The entry is not greyed for it here —
 * the issue asks only for the door — and the owner decision that hides the bar
 * on a whole-document selection will turn that case into a press with no
 * visible effect at all. Whether the entry is then greyed is owed to whichever
 * issue carries that change.
 *
 * It lives here rather than inline in `main.ts` so a test can drive the same
 * object the application spreads into `setupMenu`, which is the shape
 * `history-routes.ts` records.
 */

export interface SelectAllMenuCallbacks {
  readonly onSelectAll: () => void;
}

/**
 * The menu mapping. The command gives focus back to the document first, as Undo
 * and Redo do: the menu hands focus to its toggle as it closes, and a selection
 * made in a document that does not have focus is a selection nobody can type
 * over.
 */
export function selectAllMenuCallbacks(editor: Editor): SelectAllMenuCallbacks {
  return {
    onSelectAll: () => {
      editor.chain().focus().selectAll().run();
    },
  };
}
