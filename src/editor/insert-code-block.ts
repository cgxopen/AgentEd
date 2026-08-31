import type { Editor } from '@tiptap/core';

/**
 * The one command behind every route to a fenced block (#204).
 *
 * The Edit menu entry, the `Ctrl+Shift+K` binding and the toolbar button all
 * end here. It lives at one address rather than being spelled three times so
 * the routes cannot drift into doing different things — and so a test that
 * drives it is driving what the product actually runs. A test that spelled the
 * command itself would go on passing while every route in the application had
 * been changed underneath it, which is the shape #146 named.
 *
 * `toggleCodeBlock` rather than `setCodeBlock`, for two measured reasons: it
 * works from an empty caret, which is the case this issue was filed for, and
 * it toggles back out the way every other block button in the toolbar does.
 */
export function insertCodeBlock(editor: Editor): void {
  editor.chain().focus().toggleCodeBlock().run();
}
