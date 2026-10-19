import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { modIsCommand } from '../ui/chord-label';
import { FOOTNOTE_REFERENCE } from './markdown/footnote';

/**
 * Making a footnote — the reference where the person is, the definition at the
 * end of the document, in one transaction (#409).
 *
 * The shape is the owner decision of 2026-09-22, taken on the step zero
 * figures recorded on that issue:
 *
 *  - the reference lands **after** the selection, which stays where it is;
 *  - the definition goes at the **end of the document**, because GitHub
 *    collects every definition into one section at the end whatever the file
 *    does — measured through `gh api markdown`, a definition written in the
 *    middle and one written at the end render identically;
 *  - the label is the **smallest free number**, and the next one where that is
 *    taken;
 *  - both halves are written in **one transaction**, so one press of undo
 *    takes the pair back (R-C16). Measured before it was written: two
 *    commands are two steps, and the first undo left the reference standing
 *    with its definition gone.
 *
 * It lives here rather than inline in `main.ts` for the reason
 * `insert-blocks.ts` records: a test spelling the command itself goes on
 * passing while the route the application runs is changed underneath it.
 * Three callers share this one address — the floating-toolbar control, the
 * Insert menu entry and `Ctrl+Alt+F` — because all three promise the same
 * thing, which is what #279 split the two code-block routes over.
 */

/**
 * The most labels read out of one document, and the highest number tried.
 *
 * A document past it gets the number after the last one counted, which may
 * collide; at a hundred thousand references that is a document no one is
 * editing by hand. The bound is here rather than implied because this walks
 * user text.
 */
const LABEL_LIMIT = 100000;

/**
 * The smallest number no label in the document is using.
 *
 * **Every bracket run is counted, definitions included**, which is a superset
 * of the definition nodes the decision names — and it is the superset on
 * purpose. A reference whose definition was deleted, or one the person typed
 * and has not defined yet, keeps its label out of the pool: reusing it would
 * hand that orphan a meaning it did not have, since GitHub points every
 * reference with a label at the one definition carrying it. Counted from the
 * text rather than from the nodes, so both shapes are seen in one walk.
 */
export function nextFreeLabel(doc: ProseMirrorNode): string {
  const text = doc.textBetween(0, doc.content.size, '\n', '\n');
  const taken = new Set<string>();
  let counted = 0;
  for (const match of text.matchAll(FOOTNOTE_REFERENCE)) {
    if (counted >= LABEL_LIMIT) break;
    counted += 1;
    taken.add(match[1]);
  }
  for (let candidate = 1; candidate <= LABEL_LIMIT; candidate += 1) {
    const label = String(candidate);
    if (!taken.has(label)) return label;
  }
  return String(LABEL_LIMIT + 1);
}

/**
 * The reference and its definition, in one transaction.
 *
 * The reference is inserted as a text node of its own rather than through
 * `insertText`, so it carries **no marks**: written at the end of a bold
 * selection, `insertText` would inherit the bold and the file would hold
 * `**word[^1]**`. A reference is not emphasis.
 *
 * The caret ends inside the new definition, which is where the person has to
 * type next — the shape `insertCodeBlock` uses for a new fence, including the
 * scroll, because a definition appended below the fold would read as a press
 * that did nothing.
 */
export function insertFootnote(editor: Editor): void {
  editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const definitionType = state.schema.nodes.footnoteDefinition;
      if (!definitionType) return false;
      // The command declines the selections the surfaces refuse, so a caller
      // that does not ask first cannot reach them either (#425).
      if (!canInsertFootnote(editor)) return false;
      if (!dispatch) return true;
      const label = nextFreeLabel(tr.doc);
      tr.insert(tr.selection.to, state.schema.text(`[^${label}]`));
      // The body carries the marker and one space, so the caret lands where
      // the note is written. A definition with nothing after the colon is
      // saved as `[^1]:` — the trailing space does not survive a save, which
      // is not a footnote rule: a paragraph loses one too.
      const definition = definitionType.create(null, state.schema.text(`[^${label}]: `));
      const end = tr.doc.content.size;
      tr.insert(end, definition);
      tr.setSelection(TextSelection.near(tr.doc.resolve(end + definition.nodeSize - 1)));
      tr.scrollIntoView();
      return true;
    })
    .run();
}

/** The key the menu greys the Footnote entry from. */
export const INSERT_FOOTNOTE_KEY = 'insertFootnote';

/**
 * Whether this selection is one a footnote can be made from.
 *
 * Four states it is not, and every one of them was **driven** rather than
 * assumed:
 *
 *  - **Inside a fenced block.** `[^1]` written there is the literal text of a
 *    code sample, and the definition at the end would answer to nothing.
 *  - **Inside a footnote definition.** Driven at `37d4c07` with the caret
 *    where a load leaves it, at the end of a document ending in a definition:
 *    the reference landed *inside the note*, giving `[^1]: one[^2]`, and the
 *    new definition followed it on the next line. A note is where a footnote
 *    is explained, not where one is made.
 *  - **A whole-document selection** (#425). The reference is written at
 *    `selection.to`, and for an `AllSelection` that is the end of the
 *    document, a block position — so it was fitted into a **paragraph of its
 *    own**: driven at `42457a3`, `Ctrl+A` then the entry left `[^1]` standing
 *    alone between the last paragraph and the definition, stable across
 *    saves. Nothing was damaged and nothing was asked for either: the
 *    reference refers to none of what was selected.
 *  - **A cell selection** (#425), where the same position is a cell boundary.
 *    Driven at the same head, it wrote `| one | two<p>[^1]</p> |` — **raw
 *    HTML into the cell**, which is the spelling this repository gives a cell
 *    holding a block, and which held still on the second save rather than
 *    healing.
 *
 * The two surfaces answer it differently, each the way its own kind of
 * control already does: the bar **does not draw** a control it cannot act
 * with (owner decision of 2026-09-17, for the image description), and the
 * menu **greys** the entry (R-C5 for the same dialog, and the #275 shape —
 * an entry that would do nothing is greyed rather than pressed in silence).
 * The toolbar is hidden for a whole-document selection anyway (#336) and has
 * no bar to draw over a cell selection, so those two are the menu entry and
 * the chord alone.
 */
export function canInsertFootnote(editor: Editor): boolean {
  const { selection } = editor.state;
  if (selection instanceof AllSelection || selection instanceof CellSelection) return false;
  return !editor.isActive('codeBlock') && !editor.isActive('footnoteDefinition');
}

/**
 * Which entries the menu can offer, in the shape `setupMenu` reads when it
 * opens — the same shape `image-description.ts` and `table-shape.ts` use.
 */
export function footnoteAvailability(editor: Editor): Record<string, boolean> {
  return { [INSERT_FOOTNOTE_KEY]: canInsertFootnote(editor) };
}

/** The Insert menu entry, as the mapping from the caller to what it runs. */
export interface FootnoteRoutes {
  readonly onInsertFootnote: () => void;
}

export function footnoteMenuCallbacks(editor: Editor): FootnoteRoutes {
  return { onInsertFootnote: () => insertFootnote(editor) };
}

/**
 * `Ctrl+Alt+F`, and `Cmd+Option+N` on a Mac (#630), bound in the editor rather
 * than in `src/app/keyboard.ts`.
 *
 * The chord writes into the document, so the document is what it asks for:
 * bound here it fires while the editor has focus and not while the caret is
 * in the search field or on a header button — the line #306 drew for undo and
 * redo. The route that works with nothing focused is the menu entry, which is
 * also the route with no selection, the floating toolbar being hidden at a
 * bare caret.
 *
 * Measured free on the running editor before it was chosen (#409 step zero),
 * in Chromium on Linux. **WebView2 reserves its own combinations and that is
 * where it counts**, so the manual pass on the artifact is where this is
 * verified; `Ctrl+Shift+F` measured equally free and is the fallback.
 */
export const FOOTNOTE_SHORTCUT = {
  /**
   * What ProseMirror binds where `Mod` is Ctrl: Windows and Linux. A Mac binds
   * `macBinding`, Option+Cmd+N, since Option+Cmd+F is Find and Replace there
   * and Replace took it (#630, owner decision of 2026-10-19).
   */
  binding: 'Mod-Alt-f',
  macBinding: 'Mod-Alt-n',
  /**
   * What a person reads, in the menu tooltip and on the toolbar button, in the
   * Windows spelling every label is written in; `chordLabel` spells it
   * Cmd+Option+N on a Mac, through `MAC_CHORDS`.
   */
  chord: 'Ctrl+Alt+F',
} as const;

/** The binding of the footnote for the keymap of this platform. */
export function footnoteBinding(command: boolean = modIsCommand()): string {
  return command ? FOOTNOTE_SHORTCUT.macBinding : FOOTNOTE_SHORTCUT.binding;
}

export const FootnoteShortcut = Extension.create({
  name: 'footnoteShortcut',
  addKeyboardShortcuts() {
    return {
      [footnoteBinding()]: () => {
        if (!canInsertFootnote(this.editor)) return false;
        insertFootnote(this.editor);
        return true;
      },
    };
  },
});
