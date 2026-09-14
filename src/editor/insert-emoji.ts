import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';

/**
 * Put one emoji at the caret, replacing a selection if there is one, as
 * **one** step of undo (#296).
 *
 * An emoji is text, so this inserts the characters and nothing else: no node,
 * no mark, no attribute, which is why what reaches the file is what was chosen.
 *
 * ── Why the history is closed twice ──
 *
 * `prosemirror-history` joins a change to the previous event when the two are
 * adjacent and less than `newGroupDelay` apart. `closeHistory` on the insertion
 * starts a new event for it, so a word typed just before is not undone with
 * the emoji. It does not stop the next change from joining the emoji's event,
 * though: the flag resets the timer before the transaction it rides on is
 * recorded. The empty transaction after it resets the timer again, so a word
 * typed just after starts its own.
 */
export function insertEmoji(editor: Editor, char: string): void {
  const { view } = editor;
  view.dispatch(closeHistory(view.state.tr.insertText(char).scrollIntoView()));
  view.dispatch(closeHistory(view.state.tr));
  editor.commands.focus();
}
