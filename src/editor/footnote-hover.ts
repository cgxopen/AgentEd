import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { FOOTNOTE_REFERENCE } from './markdown/footnote';

/**
 * A reference shows the note it points at, under the pointer (#409).
 *
 * The owner decision of 2026-09-22, taken on the step zero figures: the
 * definition **stays where the file put it** and is read on hover, rather
 * than being drawn at the end of the document or beside the reference. The
 * two alternatives were refused on what they cost — drawing at the end needs
 * a flex container on the editor, which stops margins collapsing and takes
 * every paragraph gap in every document from 8 to 16 px (measured in
 * Chromium on the built page); drawing beside the reference needs a different
 * document model than the one #408 measured and chose.
 *
 * ── It is chrome, by construction ──
 *
 * These are decorations. A decoration is drawn by the view and exists nowhere
 * in the document model, so there is no path by which it can reach the file —
 * the same argument `code-block-language.ts` records for the label, and the
 * reason this can be built without a single new R-C2 exception.
 *
 * ── A pointer affordance, and it says so ──
 *
 * The note is read by hovering, so a keyboard user does not reach it, exactly
 * as R-C15 records for the Copy button on a fenced block. What a keyboard
 * user still has is the definition itself, which is drawn as its own line of
 * markdown where the file put it and can be read and edited there. The
 * reference carries `cursor: help`, so the pointer says there is something
 * under it before the tooltip appears.
 *
 * ── Why the title attribute rather than a surface of our own ──
 *
 * A panel drawn by this module would be the **fifth** floating surface over
 * the document, and #350 records what that costs: each one has to clamp
 * itself against the room the editor has rather than the window, or it is
 * drawn over the files panel. The title attribute is the platform's own
 * tooltip, it costs no placement code, no stylesheet and no bytes in the
 * bundle, and it is what the manual pass looks at. If the owner wants a
 * drawn card instead, it is a surface with the #350 arithmetic attached, and
 * its own issue.
 */
export const footnoteHoverKey = new PluginKey<DecorationSet>('footnoteHover');

/** The class the stylesheet gives the pointer cue. */
export const FOOTNOTE_REFERENCE_CLASS = 'footnote-reference';

/**
 * The bounds this walk carries, because it reads user text on every change of
 * the document. Past either one the rest of the document is left undecorated,
 * which costs a tooltip and never a byte.
 */
const DEFINITION_LIMIT = 5000;
const REFERENCE_LIMIT = 5000;

/** The most of a note that is put in a tooltip, in characters. */
const TOOLTIP_LIMIT = 400;

/** A definition line: the label it defines, and the body after the colon. */
const DEFINITION_LINE = /^\[\^([^\]\n]+)\]:[ \t]?([\s\S]*)$/;

/** One reference in the document: where it sits, and what it points at. */
interface ReferenceAt {
  readonly from: number;
  readonly to: number;
  readonly label: string;
}

/**
 * Every reference and every definition, in one walk.
 *
 * Text inside a **definition** is skipped: its own `[^a]:` opening is not a
 * reference to anything, and a definition already shows its text. Text inside
 * a fenced block and text carrying the code mark are skipped for the reason
 * the file says about them elsewhere — `[^1]` in a code sample is a code
 * sample.
 */
function readDocument(doc: ProseMirrorNode): {
  references: ReferenceAt[];
  notes: Map<string, string>;
} {
  const references: ReferenceAt[] = [];
  const notes = new Map<string, string>();

  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'footnoteDefinition') {
      if (notes.size < DEFINITION_LIMIT) {
        const line = DEFINITION_LINE.exec(node.textContent);
        if (line !== null && !notes.has(line[1])) notes.set(line[1], line[2]);
      }
      // Its content is the note, not a reference into the document.
      return false;
    }
    if (node.type.name === 'codeBlock') return false;
    if (!node.isText || node.text === undefined) return true;
    if (parent?.type.name === 'footnoteDefinition') return true;
    if (node.marks.some((mark) => mark.type.name === 'code')) return true;
    // Most text nodes in most documents hold no reference at all, and this
    // walk rides every change of the document. Measured at the #215 yardstick,
    // a 260 KB document with 20 references: the median walk went from 0.57 ms
    // to 0.21 ms with this line, because `matchAll` allocates an iterator per
    // node where `includes` reads the string and stops.
    if (!node.text.includes('[^')) return true;

    for (const match of node.text.matchAll(FOOTNOTE_REFERENCE)) {
      if (references.length >= REFERENCE_LIMIT) break;
      const at = match.index;
      references.push({ from: pos + at, to: pos + at + match[0].length, label: match[1] });
    }
    return true;
  });

  return { references, notes };
}

/**
 * The tooltip a reference gets, or `null` where the document defines nothing
 * for it.
 *
 * A reference with no definition is one of the four shapes R-C17 preserves on
 * purpose — GitHub draws it as literal text — so there is nothing to show and
 * nothing is drawn. An empty note is the same answer: a definition with no
 * body would give an empty tooltip, which reads as a broken one.
 */
function tooltipFor(notes: Map<string, string>, label: string): string | null {
  const note = notes.get(label);
  if (note === undefined) return null;
  // The continuation lines of a definition are hard breaks, which contribute
  // nothing to `textContent`, so the note arrives as one run of text already.
  const trimmed = note.trim();
  if (trimmed === '') return null;
  return trimmed.length > TOOLTIP_LIMIT ? `${trimmed.slice(0, TOOLTIP_LIMIT)}…` : trimmed;
}

/** Every reference the document defines a note for, decorated. */
export function footnoteHoverDecorations(doc: ProseMirrorNode): DecorationSet {
  const { references, notes } = readDocument(doc);
  const decorations: Decoration[] = [];
  for (const reference of references) {
    const title = tooltipFor(notes, reference.label);
    if (title === null) continue;
    decorations.push(
      Decoration.inline(reference.from, reference.to, {
        class: FOOTNOTE_REFERENCE_CLASS,
        title,
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * One walk per transaction that **changes the document**, and none otherwise.
 *
 * `props.decorations` is the shorter shape and it is the one #215 measured:
 * called on every view update, so a caret move pays for a walk it cannot
 * change the answer of. Held in plugin state instead, a selection change
 * costs nothing and the walk rides only the transactions that can move what
 * it reads.
 */
export function createFootnoteHoverPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: footnoteHoverKey,
    state: {
      init: (_config, state) => footnoteHoverDecorations(state.doc),
      apply: (tr, value) => (tr.docChanged ? footnoteHoverDecorations(tr.doc) : value),
    },
    props: {
      decorations(state) {
        return footnoteHoverKey.getState(state);
      },
    },
  });
}

export const FootnoteHover = Extension.create({
  name: 'footnoteHover',
  addProseMirrorPlugins() {
    return [createFootnoteHoverPlugin()];
  },
});
