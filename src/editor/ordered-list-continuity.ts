import { Extension } from '@tiptap/core';
import type { NodeType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

/**
 * Ordered lists keep numbering when a paragraph splits them (R-C1, defect D1).
 *
 * When the user breaks out of a list in the middle — Enter on an empty item,
 * or a paragraph pasted between two items — ProseMirror keeps the first half
 * as the original `orderedList` node and builds a *new* node for the
 * remainder, whose `start` attribute falls back to its default of 1. The
 * document then shows, and saves, a second list numbered from 1.
 *
 * Only that case is repaired, and a list has to clear three checks for it:
 *
 *   1. It must be *new*: mapped back through the transaction, no ordered
 *      list stood where it now begins. A list read from a file, or one the
 *      user typed, already existed and is never touched — so a document that
 *      legitimately holds two lists starting at 1 round-trips unchanged
 *      (R-C2). This is also what makes the repair terminate: the transaction
 *      it appends leaves the list existing, so the next pass skips it.
 *   2. It must be a *split remnant*: the position it occupies has to map back
 *      into an ordered list, past that list's first item. Deleting the
 *      leading items of an existing list maps back the same way but fails
 *      check 1, so it is not mistaken for a split.
 *   3. Its number comes from the list rendered above it — that list's own
 *      start plus its item count — never from the pre-split document, whose
 *      item count still includes the item the user just lifted out.
 *
 * With no ordered list above it the tail keeps the number it has: there is no
 * visible numbering to continue, and inventing one would be a guess.
 */
export const orderedListContinuityKey = new PluginKey('orderedListContinuity');

/** How far back to look for the list being continued (paragraphs in between). */
const MAX_SEPARATING_BLOCKS = 8;

interface Repair {
  pos: number;
  start: number;
}

function clamp(pos: number, doc: ProseMirrorNode): number {
  return Math.min(Math.max(pos, 0), doc.content.size);
}

/** True when no ordered list began at `rawPos` in the previous document. */
function isNewList(oldDoc: ProseMirrorNode, listType: NodeType, rawPos: number): boolean {
  return oldDoc.nodeAt(clamp(rawPos, oldDoc))?.type !== listType;
}

/** True when `rawPos` sat inside an ordered list, past its first item. */
function wasSplitFromList(oldDoc: ProseMirrorNode, listType: NodeType, rawPos: number): boolean {
  const $pos = oldDoc.resolve(clamp(rawPos, oldDoc));
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type !== listType) continue;
    return $pos.index(depth) > 0;
  }
  return false;
}

/** Number following the ordered list rendered just above `pos`, if any. */
function continuationOfListAbove(
  newDoc: ProseMirrorNode,
  listType: NodeType,
  pos: number,
): number | null {
  const $pos = newDoc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const lowest = Math.max(0, index - MAX_SEPARATING_BLOCKS);
  for (let i = index - 1; i >= lowest; i--) {
    const sibling = parent.child(i);
    if (sibling.type === listType) {
      const declared = Number(sibling.attrs.start ?? 1);
      return (Number.isFinite(declared) ? declared : 1) + sibling.childCount;
    }
    // Only the paragraph(s) that split the list may sit in between.
    if (!sibling.isTextblock) return null;
  }
  return null;
}

function findRepairs(
  transactions: readonly { mapping: Mapping }[],
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
  listType: NodeType,
): Repair[] {
  const forward = new Mapping();
  for (const tr of transactions) forward.appendMapping(tr.mapping);
  const backward = forward.invert();

  const repairs: Repair[] = [];
  // One pass, bounded by the document; no recursion of our own.
  newDoc.descendants((node, pos) => {
    if (node.type !== listType) return true;
    if (!isNewList(oldDoc, listType, backward.map(pos))) return true;
    if (!wasSplitFromList(oldDoc, listType, backward.map(pos + 1))) return true;
    const start = continuationOfListAbove(newDoc, listType, pos);
    if (start !== null && start !== node.attrs.start) repairs.push({ pos, start });
    return true;
  });
  return repairs;
}

export function createOrderedListContinuityPlugin(): Plugin {
  return new Plugin({
    key: orderedListContinuityKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const listType = newState.schema.nodes.orderedList;
      if (!listType) return null;

      const repairs = findRepairs(transactions, oldState.doc, newState.doc, listType);
      if (repairs.length === 0) return null;

      // setNodeMarkup keeps node sizes, so the positions collected above stay
      // valid across the loop.
      const tr = newState.tr;
      for (const { pos, start } of repairs) {
        const node = tr.doc.nodeAt(pos);
        if (!node || node.type !== listType) continue;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, start });
      }
      // The repaired lists already exist by the time this transaction is
      // examined, so check 1 rejects them and the repair terminates.
      return tr.steps.length > 0 ? tr : null;
    },
  });
}

export const OrderedListContinuity = Extension.create({
  name: 'orderedListContinuity',
  addProseMirrorPlugins() {
    return [createOrderedListContinuityPlugin()];
  },
});
