import type { Editor } from '@tiptap/core';
import { redoDepth, undoDepth } from '@tiptap/pm/history';

/**
 * Undo and Redo, as the two entries of the Edit section (#295).
 *
 * Both commands already shipped and were bound to chords, through the history
 * extension StarterKit registers, and nothing in the interface named them: the
 * Edit section held four entries and every one of them was search. These are a
 * route to that capability and nothing more. What undo covers is R-C16, and it
 * is unchanged here.
 *
 * **What they do not reach, stated rather than implied.** The metadata block is
 * written to application state rather than through a transaction, so neither
 * entry takes back Insert Metadata or a change typed in the metadata field.
 * That was measured on #295 and the owner chose to leave it so.
 *
 * They live here rather than inline in `main.ts` so that a test drives the same
 * object the application spreads into `setupMenu`, the shape `insert-blocks.ts`
 * records.
 */

export interface HistoryMenuCallbacks {
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

/**
 * The menu mapping. Each command gives focus back to the document, as the
 * Insert entries do: the menu hands focus to its toggle as it closes, and a
 * person who chose Undo goes on editing where the document now is.
 */
export function historyMenuCallbacks(editor: Editor): HistoryMenuCallbacks {
  return {
    onUndo: () => {
      editor.chain().focus().undo().run();
    },
    onRedo: () => {
      editor.chain().focus().redo().run();
    },
  };
}

/**
 * Whether there is a step to undo and a step to redo, read from the history
 * stacks themselves.
 *
 * `undoDepth` and `redoDepth` count the events on each stack, so this reads two
 * numbers and builds nothing. Measured on #295 in Chromium: 0.1 microseconds a
 * call, against 45.8 for asking the same through `editor.can()`. It is asked
 * when the menu opens, not on every transaction, and that choice was measured
 * too: a document load forgets the history through `updateState`, which emits
 * no transaction, so a reading taken at the last transaction still counted the
 * previous document's steps after New.
 */
export function historyAvailability(editor: Editor): {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
} {
  return {
    canUndo: undoDepth(editor.state) > 0,
    canRedo: redoDepth(editor.state) > 0,
  };
}
