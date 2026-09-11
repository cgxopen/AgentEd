import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

/**
 * The two block routes the menu grew in #266, each at one address.
 *
 * Both constructs were reachable only by typing before this: `- [ ] ` at the
 * start of a line for a checklist, and one of `---`, `___ ` or `*** ` for a
 * rule. The #261 audit found what that costs — the owner looked for a checkbox,
 * found no control anywhere, and the recorded conclusion was that a user decides
 * the product has no checklists.
 *
 * **The floating toolbar is not where they can live.** `positionToolbar` hides
 * the toolbar whenever the selection is empty, and both of these are things a
 * person starts from an empty caret, which is precisely the state that surface
 * does not exist in. So the menu is the surface, and this is the same reasoning
 * `insert-code-block.ts` was extracted under in #204.
 *
 * They live here rather than being spelled inline in `main.ts` for the reason
 * that file records: a test spelling the command itself would go on passing
 * while the route the application runs had been changed underneath it — the
 * shape #146 named. A test that drives these functions is driving what the
 * product runs.
 */

/**
 * A checklist from wherever the caret is — and, inside one, a fresh item.
 *
 * Two branches, decided by where the selection **ends** (#275):
 *
 * - **Inside a checklist item**, a fresh unticked item is added directly after
 *   that item and the caret goes into it. Nothing else in the document moves.
 *   Until #275 this ran `toggleTaskList`, and a toggle toggles *out*: the entry
 *   named Insert took the checklist away. Measured on `dbe287d` it removed the
 *   checkbox in every shape of that state that was tried — one item, the middle
 *   of three, an item holding a heading or a fence, a loose list, a selection
 *   over two items — except a nested item, which it moved out a level instead.
 * - **Anywhere else**, `toggleTaskList` as before. It works from an empty caret,
 *   which is the case #266 was filed for, and the owner decision of 2026-09-11
 *   keeps every other state as it was.
 *
 * **Why not `splitListItem`, which is what Enter runs.** It was the obvious
 * reach, and step zero reported it safe once the caret is sent to the end of
 * the item first. The edge cases measured afterwards said otherwise, because it
 * carries Enter semantics, which are right for a key and wrong for this entry:
 * in an empty item it does nothing — Enter relies on the next command to lift
 * the item out — and in an item holding two blocks it splits the item between
 * them, carrying the second block into the new item. Inserting the node is
 * exact in every shape, because it goes after the whole item whatever the item
 * holds.
 *
 * `$to` rather than `$from`, so that nothing the selection covers is touched:
 * the new item lands after the last item selected. A selection **ending**
 * outside a checklist takes the other branch even when it starts inside one;
 * measured, that nests rather than removes, and it is what the entry already
 * did there.
 *
 * The **nearest** list item decides, not any ancestor: a bullet list nested
 * inside a checklist item is a bullet list, and pressing the entry there keeps
 * what it did before. Bullet and ordered lists are the question the decision
 * set aside to be answered on its own.
 */
export function insertChecklist(editor: Editor): void {
  if (enclosingTaskItemDepth(editor.state.selection.$to) === null) {
    editor.chain().focus().toggleTaskList().run();
    return;
  }
  editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const { $to } = tr.selection;
      const depth = enclosingTaskItemDepth($to);
      const { taskItem, paragraph } = state.schema.nodes;
      const item = taskItem.createAndFill({ checked: false }, paragraph.create());
      if (depth === null || !item) return false;
      if (dispatch) {
        const after = $to.after(depth);
        tr.insert(after, item);
        // One step into the new item, one into its paragraph.
        tr.setSelection(TextSelection.create(tr.doc, after + 2));
        // The item it was added after can be tall — a long fence — and a new
        // item landing off screen would read as the silent press the owner
        // turned down. Enter asks for the same.
        tr.scrollIntoView();
      }
      return true;
    })
    .run();
}

/**
 * The depth of the list item nearest to the position, when that item is a
 * checklist item; `null` when it is a bullet or ordered item, or when there is
 * no list item at all. The walk is bounded by the depth of the position.
 */
function enclosingTaskItemDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === 'taskItem') return depth;
    if (name === 'listItem') return null;
  }
  return null;
}

/**
 * A horizontal rule at the caret.
 *
 * `setHorizontalRule` is not a toggle and has no toggling counterpart — a rule
 * is an atom rather than a wrapper, so there is nothing to toggle out of. It is
 * removed the way any other atom is, by deleting it.
 */
export function insertHorizontalRule(editor: Editor): void {
  editor.chain().focus().setHorizontalRule().run();
}

/**
 * The two menu entries #266 added, as the mapping from entry to command.
 *
 * This exists because of a measurement rather than for tidiness. With `main.ts`
 * spelling the two callbacks inline, pointing the Horizontal Rule entry at
 * `insertChecklist` turned **zero of 2813** tests red — the suite stayed fully
 * green, and only an unused import kept `tsc` from agreeing. That is the #204
 * shape exactly: a control naming one capability and running another, which is
 * worse than a missing route because the user stops looking.
 *
 * The mapping now has one address, and `menu.test.ts` drives *this* object into
 * the real rendered entries rather than restating it, so the same swap made
 * here reddens. The other half — that `main.ts` supplies these at all — is the
 * compiler's: `MenuCallbacks` requires both, so an object that stops carrying
 * them stops type-checking at the `setupMenu` call.
 *
 * The keys are declared here rather than imported from `src/ui/menu.ts`,
 * because the editor layer has no business depending on the UI layer. Nothing
 * is lost by that: a key that drifts from `MenuCallbacks` fails to compile
 * where the two meet.
 */
export interface InsertMenuCallbacks {
  readonly onInsertChecklist: () => void;
  readonly onInsertHorizontalRule: () => void;
}

export function insertMenuCallbacks(editor: Editor): InsertMenuCallbacks {
  return {
    onInsertChecklist: () => insertChecklist(editor),
    onInsertHorizontalRule: () => insertHorizontalRule(editor),
  };
}
