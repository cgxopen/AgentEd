import { type Editor, getHTMLFromFragment } from '@tiptap/core';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { fixTables } from '@tiptap/pm/tables';
import { parseDocument } from './document-load';

/**
 * The editor half of keeping a raw HTML table as its bytes (#283). The file
 * half, and the owner decision behind both, are in
 * `markdown/table-html-source.ts`.
 *
 * ── The two attributes, and why there are two ──
 *
 * `htmlSource` is the bytes the file wrote, read off the element on load. It
 * is **never rendered**: nothing that serializes the document to HTML carries
 * it. That covers the clipboard and the paste of a copy, so a copied table
 * cannot bring bytes with it that no longer describe it.
 *
 * `keptHtmlSource` is rendered, into the attribute the serializer reads, and
 * it is **never read** from HTML. It is set on a transaction that is built
 * here and never dispatched, and only on a table that passed the check below.
 * So in the document the user holds it is always empty, and the only HTML
 * that ever carries it is the HTML handed to the serializer at save.
 *
 * ── The check: is this still the table the file wrote ──
 *
 * The source is read again through the route a load takes, repaired the way
 * a load repairs a table (`asLoaded`), and the table it becomes is compared
 * with the table the editor holds, cell attributes and all. Equal, and the source is written back. Different in anything, and the
 * table is written as GFM, as every table was before #283.
 *
 * **This is exact rather than tracked.** Nothing watches for an edit, so
 * there is no edit route to miss — typing, a command, a paste into a cell, a
 * find-and-replace. It answers undo for free: an edit undone gives back a
 * table equal to the source, and the source is written again.
 *
 * **What it costs** is one parse of each such table's source, at save, and
 * nothing on any other keystroke: `getMarkdown` is called by the save path and
 * by nothing that runs while typing. A document with no raw HTML table pays
 * only the walk over its top-level blocks.
 *
 * ── Only at the top level of the document ──
 *
 * The owner decision covered the document level, so a table inside a
 * blockquote or a list item is written as GFM, as before, and REQUIREMENTS
 * records it. Measured on #283 with this walk descending instead, the shapes
 * tried there held byte for byte, on one line and across lines, so widening
 * it is a question of its own rather than a known hazard. The walk is over the
 * document's direct children, so it is bounded by their number.
 */

/** The table node attribute holding the bytes a file wrote. Never rendered. */
export const HTML_SOURCE = 'htmlSource';

/** The table node attribute the serializer writes from. Never parsed. */
export const KEPT_HTML_SOURCE = 'keptHtmlSource';

/** The paragraph attribute holding the bytes of a raw HTML block (#461). Never rendered. */
export const HTML_BLOCK_SOURCE = 'htmlBlockSource';

/** The paragraph attribute the serializer writes from (#461). Never parsed. */
export const KEPT_HTML_BLOCK_SOURCE = 'keptHtmlBlockSource';

/**
 * The document as HTML for the serializer, with each unedited raw HTML table
 * and each unedited raw HTML block of the GFM tag filter marked to be kept.
 */
export function htmlForSave(editor: Editor): string {
  const { state, schema } = editor;
  const tr = state.tr;
  let kept = 0;
  state.doc.forEach((node, offset) => {
    if (!isUneditedHtmlTable(node, schema)) return;
    // `offset` is the child's position: the document node has no opening token.
    tr.setNodeAttribute(offset, KEPT_HTML_SOURCE, node.attrs[HTML_SOURCE]);
    kept += 1;
  });
  // A block of the tag filter can sit in a quote or a list item (#461), so it
  // is looked for at every depth, where a raw table is kept at the top only.
  // Setting an attribute moves no position, so the walk's positions hold.
  state.doc.descendants((node, pos) => {
    if (!isUneditedHtmlBlock(node, schema)) return;
    tr.setNodeAttribute(pos, KEPT_HTML_BLOCK_SOURCE, node.attrs[HTML_BLOCK_SOURCE]);
    kept += 1;
  });
  return getHTMLFromFragment(kept > 0 ? tr.doc.content : state.doc.content, schema);
}

/**
 * Whether a top-level node is a table read from raw HTML whose source still
 * reads back as exactly this table.
 *
 * The content is compared rather than the whole node, because the node's own
 * attributes include `htmlSource` itself. The table's other attribute, its
 * GFM spelling, has no route to change and does not reach the bytes kept.
 */
export function isUneditedHtmlTable(node: ProseMirrorNode, schema: Schema): boolean {
  const source = node.attrs[HTML_SOURCE];
  if (node.type.name !== 'table' || typeof source !== 'string') return false;
  const reread = asLoaded(parseDocument(schema, source));
  const table = reread.firstChild;
  return (
    reread.childCount === 1 &&
    table !== null &&
    table.type === node.type &&
    table.content.eq(node.content)
  );
}

/**
 * The parsed document as the editor holds it once a load has finished.
 *
 * Parsing is not the whole of a load. The table plugin repairs every table
 * that is not rectangular in its own transaction straight after it, and a raw
 * HTML table is often not: a `<caption>` becomes a row of one cell beside rows
 * of two, and the repair adds the missing cell. Measured before this existed,
 * a table holding a caption and a `rowspan` was compared unrepaired against
 * its repaired self, counted as edited, and written as GFM by a save that
 * changed nothing. `fixTables` is the function that plugin runs, so the source
 * is repaired the same way before it is compared.
 *
 * It is the only repair a load makes to a table. The other plugins that append
 * to a transaction answer a paste, a split list or a cleared document, and a
 * load is none of those.
 */
function asLoaded(doc: ProseMirrorNode): ProseMirrorNode {
  const repair = fixTables(EditorState.create({ doc }));
  return repair ? repair.doc : doc;
}

/**
 * Whether a paragraph standing for a raw HTML block of the tag filter is still
 * what its bytes read as (#461), asked as `isUneditedHtmlTable` asks it: the
 * bytes are read again through the route a load takes, and the paragraph is
 * unedited exactly when they give the same paragraph back. So no edit route
 * can be missed, and an edit that is undone gives the bytes back.
 */
export function isUneditedHtmlBlock(node: ProseMirrorNode, schema: Schema): boolean {
  const source = node.attrs[HTML_BLOCK_SOURCE];
  if (node.type.name !== 'paragraph' || typeof source !== 'string') return false;
  const reread = parseDocument(schema, source);
  const block = reread.firstChild;
  return (
    reread.childCount === 1 &&
    block !== null &&
    block.type === node.type &&
    block.content.eq(node.content)
  );
}
