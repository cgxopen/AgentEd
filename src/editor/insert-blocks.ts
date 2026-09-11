import type { Editor } from '@tiptap/core';

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
 * A checklist from wherever the caret is.
 *
 * `toggleTaskList` rather than a command that only ever adds one: it works from
 * an empty caret, which is the case #266 was filed for, and it toggles back out,
 * which is what every other list control in this editor does. The item it makes
 * is unticked; ticking it is a separate gesture on the checkbox.
 */
export function insertChecklist(editor: Editor): void {
  editor.chain().focus().toggleTaskList().run();
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
