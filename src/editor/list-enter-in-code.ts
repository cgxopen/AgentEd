import type { KeyboardShortcutCommand } from '@tiptap/core';

/**
 * Enter in a code block inside a list item adds a line (#679).
 *
 * The list item and the task item bind Enter to `splitListItem`, and among
 * extensions of the same priority TipTap runs the keyboard shortcuts of a
 * later one first: `ExtensionManager` reverses the extension list and sorts it
 * again by priority before it builds the plugins, so a node registered after
 * the code block and after TipTap's own `keymap` extension answers a key
 * before them. `listItem` and `taskItem` both come after `codeBlock` and
 * `keymap` in this build, so `splitListItem` ran first and split the item,
 * and the code block with it, at any caret position and over a range in the
 * code. The exit of the code block on a third Enter and the newline of the
 * core keymap never ran.
 *
 * So the Enter of a list item gives way while the selection starts in a code
 * block, and the next binding answers as it does outside a list: the code
 * block leaves on a third Enter at the end, and otherwise the core keymap
 * runs `newlineInCode`. Everywhere else the inherited Enter runs unchanged,
 * so a paragraph of an item splits and an empty last item leaves the list as
 * before. Raising the priority of the code block was measured too and works,
 * but it moves every plugin of the code block ahead of every other extension,
 * not Enter alone.
 */
export function enterGivingWayInCode(
  shortcuts: Record<string, KeyboardShortcutCommand>,
): Record<string, KeyboardShortcutCommand> {
  const enter = shortcuts.Enter;
  if (!enter) return shortcuts;
  return {
    ...shortcuts,
    Enter: (props) =>
      props.editor.state.selection.$from.parent.type.spec.code ? false : enter(props),
  };
}
