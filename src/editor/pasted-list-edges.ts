import { type Node as ProseMirrorNode, Slice } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

/**
 * A list pasted as HTML arrives whole (#690, route d, owner decision of
 * 2026-11-03).
 *
 * Rich HTML from another application, or from another AgentEd window, is
 * cleaned and parsed again (`cleanPastedHtml`, then `parseSlice`), and
 * `parseSlice` returns a slice open as deep as it can go at both ends. For a
 * paragraph that is what lets pasted words join the sentence at the caret.
 * For a list it is harm: the open start runs down through the list, its first
 * item and that item paragraph, so the first item was joined to the text
 * before the caret and lost its marker and box; the open end did the same with
 * the last item and the text after the caret. A paste in the same window does
 * not do this, because its slice carries the depths it was copied at, which a
 * copy from elsewhere cannot carry under #447.
 *
 * So the content decides here, and nothing the other window wrote is trusted.
 * At each end the walk goes down the open edge of the slice and stops at the
 * first list it meets; that end is then opened only down to the list, so the
 * list itself is closed and arrives as a whole block. An end that meets no
 * list, a paragraph for one, is left as parsed and still joins the text. The
 * walk is bounded by the open depth of that end: nothing below it is open.
 *
 * The cleaned route alone calls this. A copy from this window keeps going to
 * ProseMirror, and the copy token is not read here.
 */

/**
 * The depth of the first list on the open edge of `slice` at one end, or null
 * when that edge meets none before its open depth.
 */
function listDepthOnEdge(slice: Slice, atStart: boolean): number | null {
  const open = atStart ? slice.openStart : slice.openEnd;
  let node: ProseMirrorNode | null = atStart ? slice.content.firstChild : slice.content.lastChild;
  for (let depth = 0; node !== null && depth < open; depth++) {
    if (node.type.isInGroup('list')) return depth;
    node = atStart ? node.firstChild : node.lastChild;
  }
  return null;
}

/**
 * `slice` with each list edge opened only down to the list it meets, or null
 * when neither edge meets a list, so the caller keeps the slice and the
 * insertion it had.
 */
export function withListEdgesWhole(slice: Slice): Slice | null {
  const start = listDepthOnEdge(slice, true);
  const end = listDepthOnEdge(slice, false);
  if (start === null && end === null) return null;
  return new Slice(slice.content, start ?? slice.openStart, end ?? slice.openEnd);
}

/**
 * A slice whose list edges were made whole, put over the selection the way
 * ProseMirror puts a paste in the same window (`doPaste` and
 * `sliceSingleNode` in prosemirror-view 1.42.6): a slice closed at both ends
 * that holds one block is inserted with
 * `replaceSelectionWith`, any other with `replaceSelection`. It is asked only
 * of a slice `withListEdgesWhole` changed, so a paste with no list at an edge
 * keeps `replaceSelection`, as before.
 *
 * The difference is seen at the start of a block. A list closed at both ends,
 * pasted at the start of a heading, is placed by `replaceSelection` after an
 * empty heading it leaves behind, a block the copy never held;
 * `replaceSelectionWith` puts the list before the heading, as the same window
 * does. Marks at the caret are not carried onto the block, as in a paste.
 */
export function replaceSelectionWithPaste(tr: Transaction, slice: Slice): Transaction {
  const single =
    slice.openStart === 0 && slice.openEnd === 0 && slice.content.childCount === 1
      ? slice.content.firstChild
      : null;
  return single !== null ? tr.replaceSelectionWith(single, false) : tr.replaceSelection(slice);
}
