import { Extension, getTextBetween, getTextSerializersFromSchema } from '@tiptap/core';
import {
  Fragment,
  type Node as ProseMirrorNode,
  type ResolvedPos,
  type Schema,
  type Slice,
} from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import * as proseMirrorView from '@tiptap/pm/view';
import { COPY_TOKEN_ATTRIBUTE } from './clipboard-token';
import { markdownOfBlocks } from './document-markdown';

/**
 * The plain text of a copy or a cut is the markdown the file would hold for
 * what was copied (#697, owner decisions of 2026-11-04).
 *
 * A copy puts two flavours on the clipboard. The HTML one is written by
 * ProseMirror with the token of #447 and is not touched here. The plain one
 * is what a plain text field, a chat box or a terminal receives; TipTap fills
 * it by default with the words alone, a blank line at every block boundary
 * (`ClipboardTextSerializer`, a core extension). The plugin below answers
 * before it, because TipTap asks the extensions it was given before its own.
 *
 * Three shapes are written otherwise than the whole blocks are:
 *
 *   - **a selection inside one textblock** writes its inline markdown alone,
 *     bold and links, without the syntax of the block or of the list, quote
 *     or table around it; inside a code block, its literal text (decision 4).
 *     A selection covering the whole text of the block is a whole block;
 *   - **a selection of cells** is handed over as rows, which are written as a
 *     table of those cells, the first row its header, as GFM requires
 *     (decision 6);
 *   - **a copy above the bounds below** leaves the plain text to TipTap, the
 *     text of `main`, rather than freezing the window (decision 7).
 */

/**
 * Above these bounds the plain text of a copy is the words alone, as on `main`.
 *
 * The save serializer runs on the copy, on the UI thread, and its cost follows
 * the number of blocks more than the size, and grows faster than either.
 * Measured on #697 in Chromium on the development server, a Select All then a
 * copy, the median of three: prefixes of the constructed file of the timing
 * census (`releases.md`, 884 KB), the dearest shape measured, took 98 ms at
 * 1648 blocks, 230 ms at 3396, 459 ms at 5290, 1031 ms at 7359 and 8049 ms
 * whole, at 17262; REQUIREMENTS.md of this repository took 60 ms at 262 blocks
 * and a size of 242329, and four copies of it end to end 395 ms at 1048 blocks
 * and a size of 969316. So the blocks are bounded at 4000, about 300 ms in the
 * dearest shape, and the size at 500000, about 200 ms in the plainest: a copy
 * stays well under a second there, the whole census file falls back, and
 * README.md and REQUIREMENTS.md are written as markdown.
 */
export const MAX_MARKDOWN_COPY_BLOCKS = 4000;
export const MAX_MARKDOWN_COPY_SIZE = 500_000;

/** Whether a slice is above the bounds; the count stops at the bound. */
function aboveTheBounds(slice: Slice): boolean {
  if (slice.content.size > MAX_MARKDOWN_COPY_SIZE) return true;
  let blocks = 0;
  slice.content.descendants((node) => {
    if (blocks > MAX_MARKDOWN_COPY_BLOCKS) return false;
    if (node.isBlock) blocks += 1;
    return true;
  });
  return blocks > MAX_MARKDOWN_COPY_BLOCKS;
}

/** The markdown for a copied slice, or the empty string to leave it to TipTap. */
export function clipboardMarkdown(slice: Slice, state: EditorState): string {
  if (aboveTheBounds(slice)) return '';
  const inline = inlineMarkdown(state);
  if (inline !== null) return inline;
  return markdownOfBlocks(asBlocks(slice.content, state.schema), state.schema);
}

/**
 * The inline markdown of a selection inside one textblock, or `null` when the
 * selection is a whole block or crosses blocks.
 *
 * Read from the selection, which is what a copy, a cut and a drag hand over:
 * the slice alone cannot tell part of a block from all of its text, since both
 * are the block cut open at each end.
 */
function inlineMarkdown(state: EditorState): string | null {
  const { $from, $to } = state.selection;
  const block = $from.parent;
  if (!block.isTextblock || !$from.sameParent($to)) return null;
  if ($from.parentOffset === 0 && $to.parentOffset >= wholeTextEnd(block)) return null;
  if (block.type.spec.code) return block.textBetween($from.parentOffset, $to.parentOffset);
  const inline = block.content.cut($from.parentOffset, $to.parentOffset);
  const paragraph = state.schema.nodes.paragraph.create(null, inline);
  return markdownOfBlocks(Fragment.from(paragraph), state.schema);
}

/**
 * Where the text of a block ends for the eye. A code block opened from a file
 * holds the line ending that ends its last line, drawn as one line more (the
 * DEBT entry on blocks drawn one line taller), so a selection of all its lines
 * that stops before that line ending is the whole block.
 */
function wholeTextEnd(block: ProseMirrorNode): number {
  const size = block.content.size;
  return block.type.spec.code && block.textContent.endsWith('\n') ? size - 1 : size;
}

/** The table node type of the schema, if it has one. */
function tableNodeType(schema: Schema) {
  return Object.values(schema.nodes).find((type) => type.spec.tableRole === 'table');
}

/**
 * The copied content as blocks a document can hold: rows, which a selection
 * of cells hands over, are put in a table.
 */
function asBlocks(content: Fragment, schema: Schema): Fragment {
  const table = tableNodeType(schema);
  if (content.firstChild?.type.spec.tableRole !== 'row' || table === undefined) return content;
  return Fragment.from(table.create(null, content));
}

/**
 * Whether HTML on the clipboard was put there by AgentEd, from this window or
 * another, by the copy attribute of #447 with any value.
 *
 * It chooses words over characters for a paste into a code block and nothing
 * else: the words are inserted as text, so no attribute or markup of the copy
 * reaches the document by this route, and a page that spells the attribute
 * gets its own words back.
 */
export function isAgentEdCopy(html: string): boolean {
  return html.includes(`${COPY_TOKEN_ATTRIBUTE}=`);
}

type ParseFromClipboard = (
  view: EditorView,
  text: string,
  html: string | null,
  plainText: boolean,
  $context: ResolvedPos,
) => Slice | null;

/**
 * The reader ProseMirror uses for a paste, which `prosemirror-view` exports as
 * `__parseFromClipboard` and leaves out of its types, the way `paste.ts`
 * imports the cell reader of `prosemirror-tables`. Looked up rather than
 * imported by name so that the type check passes; `clipboard-text.test.ts`
 * asserts it is there, so a version that drops it turns the suite red rather
 * than the paste quiet.
 */
export const parseFromClipboard = (
  proseMirrorView as unknown as { __parseFromClipboard?: ParseFromClipboard }
).__parseFromClipboard;

/**
 * The words of an AgentEd copy: the plain text TipTap writes for it, on
 * `main` the plain text of every copy, recomputed from the HTML flavour.
 *
 * ProseMirror reads the HTML back into the slice it was written from, its
 * open ends included, through the reader it uses for a paste. TipTap writes
 * the text between the two ends of the selection; the slice holds the same
 * nodes in the same order, so the text between its open ends is the same
 * text. A selection of cells is the exception: TipTap reads from the start of
 * the first cell to the end of the last, which is where the range starts and
 * ends here too. `null` when the reader is missing, and the caller then
 * inserts the plain text as it stands.
 */
export function wordsOfCopy(view: EditorView, html: string): string | null {
  if (parseFromClipboard === undefined) return null;
  const { schema, doc } = view.state;
  const slice = parseFromClipboard(view, '', html, false, doc.resolve(0));
  if (!slice) return '';
  const copied = schema.topNodeType.create(null, slice.content);
  const range = cellRange(copied) ?? {
    from: slice.openStart,
    to: slice.content.size - slice.openEnd,
  };
  return getTextBetween(copied, range, { textSerializers: getTextSerializersFromSchema(schema) });
}

/** From inside the first cell to inside the last, when the copy holds cells. */
function cellRange(copied: ProseMirrorNode): { from: number; to: number } | null {
  const top = copied.firstChild?.type.spec.tableRole;
  if (top !== 'table' && top !== 'row') return null;
  let from = -1;
  let to = -1;
  copied.descendants((node, pos) => {
    const role = node.type.spec.tableRole;
    if (role !== 'cell' && role !== 'header_cell') return true;
    if (from < 0) from = pos + 1;
    to = pos + node.nodeSize - 1;
    return false;
  });
  return from < 0 ? null : { from, to };
}

export const ClipboardMarkdown = Extension.create({
  name: 'clipboardMarkdown',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('clipboardMarkdown'),
        props: {
          clipboardTextSerializer: (slice: Slice, view: EditorView) => {
            try {
              return clipboardMarkdown(slice, view.state);
            } catch (error) {
              // The copy still happens, with the words TipTap writes: the
              // empty string hands the plain text to it.
              console.error('[agented] failed to write the copy as markdown:', error);
              return '';
            }
          },
        },
      }),
    ];
  },
});
