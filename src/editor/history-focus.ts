import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/**
 * Undo and redo reach the document only while the document has focus (#306).
 *
 * **The mechanism, measured on #306 in Chromium and on WebView2.** The page has
 * one undo stack. Ctrl+Z pressed with focus outside the editor — in the
 * metadata field, the search or replace field, a dialog field, on a button, or
 * with nothing focused at all — first spends the steps of the focused field,
 * if it has any; once those are gone, the browser raises `beforeinput` with
 * `inputType: historyUndo` **aimed at the editor**, while `activeElement` stays
 * where it was. The history plugin handles that event like a keystroke in the
 * document, so a step left the body in a part of the screen the user was not
 * looking at. Straight after Insert Metadata the field has no steps of its
 * own, so the very first press did it.
 *
 * **Which input is refused is decided by who owns the keystroke**, the test
 * `armPlainPasteOnKeydown` in `paste.ts` applies to a different key: the event
 * must be aimed inside the editor, and focus must be outside it. A field's own
 * undo is aimed at the field and never reaches this; a keystroke in the
 * document is aimed at the document with focus in it, and is let through.
 *
 * **Redo is refused as well as undo**, by owner decision of 2026-09-15. Measured
 * on both runtimes, redo pressed from outside the editor reaches nothing today:
 * the history plugin prevents every undo aimed at it, so the browser performs
 * none and has nothing to redo. Refusing it costs nothing that works, and it
 * covers the mirrored case — the body changing on redo while the user looks at
 * a field — should a runtime ever raise it.
 *
 * **A capture listener on the document, not a prop on the view.** A prop runs
 * only if the plugin holding it comes before the history plugin: measured on
 * #306, the same refusal written as `handleDOMEvents` worked at priority 1000
 * and refused nothing at priority 1. This listener runs before any handler on
 * the view whatever order the extensions are registered in, and it behaved the
 * same at both priorities.
 *
 * **Both halves of the refusal are required.** `stopImmediatePropagation` keeps
 * the event from the history plugin; `preventDefault` keeps it from the
 * browser. Measured on #306 with the second removed: the browser then ran its
 * own undo on the editor's DOM, one character a press, and moved focus into
 * the editor — worse than the defect.
 *
 * **What this does not reach.** Chords the editor's keymap and the global
 * keymap bind are `keydown`, not history input, and are untouched. And where a
 * field was typed in before the body, the field's own older step stays
 * unreachable from the field: the browser's topmost entry is the editor's and
 * is never taken off its stack. That was so before this guard; the press now
 * does nothing where it used to take a step out of the body.
 */

function isHistoryInput(event: Event): boolean {
  if (!(event instanceof InputEvent)) return false;
  return event.inputType === 'historyUndo' || event.inputType === 'historyRedo';
}

/**
 * Refuse history input aimed at the editor while focus is outside it. Returns
 * the function that removes the listener.
 */
export function refuseHistoryOutsideFocus(view: EditorView): () => void {
  const doc = view.dom.ownerDocument;

  function onBeforeInput(event: Event): void {
    if (!isHistoryInput(event)) return;
    const target = event.target;
    if (!(target instanceof Node) || !view.dom.contains(target)) return;
    const focused = doc.activeElement;
    if (focused !== null && view.dom.contains(focused)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  doc.addEventListener('beforeinput', onBeforeInput, true);
  return () => doc.removeEventListener('beforeinput', onBeforeInput, true);
}

export const HistoryStaysWithFocus = Extension.create({
  name: 'historyStaysWithFocus',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('historyStaysWithFocus'),
        view(view) {
          return { destroy: refuseHistoryOutsideFocus(view) };
        },
      }),
    ];
  },
});
