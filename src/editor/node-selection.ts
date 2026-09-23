import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { NodeSelection } from '@tiptap/pm/state';

/**
 * Whether what is selected is a node rather than a stretch of text (#427).
 *
 * ── What this answers for, and what a node selection is here ──
 *
 * Two nodes in this document can be selected by a click, and they are the two
 * that are selectable atoms: an **image** and a **horizontal rule**.
 * `setup.ts` says so where it declares them, and it was measured rather than
 * read - an HTML comment carries `selectable: false`, and a footnote
 * definition holds inline content, so a click puts a caret inside it instead.
 *
 * **What the answer is used for is refusing, not styling.** Inline code and
 * the fenced block each took a selected image out of the document in one
 * press: the first wrote the image markdown as literal text inside a code
 * span, the second left an empty fence where the picture had been. Measured on
 * `8934c82`, and reachable by four routes - the two toolbar buttons, `Ctrl+E`,
 * `Ctrl+Shift+K` and the Edit menu entry - which is why the refusal is at the
 * two commands and not at the bar. The bar then stops drawing the two buttons
 * for the same reason it already leaves out a control that cannot act (owner
 * decision of 2026-09-17), which is cosmetic once the commands refuse.
 *
 * **Why the selection type rather than what is inside it.** A rule that asked
 * *is there an image here* would have to be repeated for every node the schema
 * gains afterwards, and would answer yes with the caret merely beside one -
 * the reason `image-description.ts` gives for asking `isActive` instead of
 * `can()`. The selection type is one question with one answer, and a node the
 * schema gains tomorrow is covered on the day it becomes selectable.
 */
export function isNodeSelected(state: EditorState): boolean {
  return state.selection instanceof NodeSelection;
}

/** The same question for a caller holding the editor rather than its state. */
export function hasNodeSelection(editor: Editor): boolean {
  return isNodeSelected(editor.state);
}
