import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

/**
 * The routes to a fenced block, and since #279 there are **two commands rather
 * than one** — deliberately, with the reason recorded here beside both.
 *
 * #204 put every route at one address so they could not drift: the Edit menu
 * entry, `Ctrl+Shift+K` and the floating-toolbar button all ran
 * `toggleCodeBlock`. Measured on `154eba0`, all three still agreed in eleven
 * caret states — the property held. What they do not share is what they promise.
 *
 * **The button is a toggle and looks like one**: with a selection inside a
 * fence it carries the `active` class the stylesheet lights, so pressing it to
 * leave the block is what it is offering. A chord is a toggle for the same
 * reason, argued on #271 when the heading buttons stopped toggling and the
 * chords deliberately did not. **The menu entry says Insert**, and pressing it
 * inside a fence took the fence away, along with its language: measured, a
 * block carrying `js` came back as plain text with the language gone and
 * nothing to restore it.
 *
 * So the entry moves and the other two stay, by owner decision of 2026-09-12.
 * The address is **split rather than lost**: two functions, one per promise,
 * each pinned by its own test in `code-block-routes.test.ts`, so a later drift
 * fails there rather than passing quietly.
 */

/**
 * The Edit menu entry.
 *
 * Outside a fence it makes one, which is the case the entry is named for and
 * the case #204 was filed for. **Inside a fence it adds a new empty one after
 * it** and puts the caret there — the answer #277 and #280 gave for a checklist
 * and a table, measured here in five shapes: the fence the caret was in keeps
 * its language, the two are written a blank line apart, and the file holds
 * still. Doing nothing was turned down on #275, and `setCodeBlock` was measured
 * to be exactly that: inside a fence it runs and changes nothing.
 */
export function insertCodeBlock(editor: Editor): void {
  editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch, commands }) => {
      const depth = enclosingCodeBlockDepth(tr.selection.$to);
      if (depth === null) return commands.toggleCodeBlock();
      const fence = state.schema.nodes.codeBlock.createAndFill();
      if (!fence) return false;
      if (dispatch) {
        const after = tr.selection.$to.after(depth);
        tr.insert(after, fence);
        // Into the new fence, which is empty, so the position just inside it.
        tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
        // The fence it was added after can fill the window; a new one landing
        // below the fold would read as the silent press this repair is about.
        tr.scrollIntoView();
      }
      return true;
    })
    .run();
}

/**
 * `Ctrl+Shift+K` and the floating-toolbar button.
 *
 * Unchanged by #279 and unchanged since #204: it toggles, which is what a lit
 * button and a chord both offer. This is the only thing that leaves a fence
 * from the keyboard, so it is not a duplicate of the entry above.
 */
export function toggleCodeBlock(editor: Editor): void {
  editor.chain().focus().toggleCodeBlock().run();
}

/**
 * The depth of the code block the position is in, or `null` outside one. A
 * fence holds text and never another block, so the nearest is the only one.
 * Bounded by the depth of the position.
 */
function enclosingCodeBlockDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'codeBlock') return depth;
  }
  return null;
}
