import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isReferenceDefinition, type Reread, rereadFor } from './kept-block-reread';
import { HTML_BLOCK_SOURCE, isUneditedHtmlBlock, uneditedRegionSize } from './kept-html-table';
import { inertTemplate } from './markdown/inert-html';

/**
 * A block the file centres with its HTML is drawn centred (#699).
 *
 * GitHub centres what a `p` or a `div` with an `align` of `center` wraps, what
 * a `center` wraps, and a heading `h1` to `h6` carrying that `align`. The file
 * keeps those bytes on an unedited save (#468, #470): the block reaches the
 * editor as a paragraph or a heading carrying them in `htmlBlockSource`, and
 * the save writes them back while the block reads back from them unchanged.
 *
 * **Drawn centred only while the save would keep the wrapper.** The question
 * is the one the save asks, through the same two functions, `isUneditedHtmlBlock`
 * for a block and `uneditedRegionSize` for bytes that read back as several
 * blocks, with the reference definitions of the document as the save reads
 * them. So once an edit means the save will let the wrapper go, option i of
 * #468, the block is drawn at the left, as the save will write it, and an undo
 * that gives the bytes back draws it centred again.
 *
 * **A decoration, not an attribute.** The class is drawn on the node by a
 * ProseMirror decoration, which neither the clipboard serializer nor the save
 * reads, so both flavours of a copy and the file are as before; and it is a
 * class, so the centring is in the stylesheet and the CSP, `style-src` of
 * `self`, is unchanged.
 *
 * **The cost on each change.** Every block is visited and returned from at
 * its textblock, so the walk is bounded by the blocks of the document; the
 * reference definitions are gathered in the same walk. Whether bytes centre
 * their block, and what they read back as, are kept per bytes, the second
 * while the definitions are the same nodes, so only bytes not yet seen are
 * parsed, and the caches keep only the bytes the document still holds.
 * Measured on #699: 2.5 ms a keystroke on the largest file of the corpus
 * snapshot, 956 KB with no centred block, and at most 5.4 ms with the README
 * placed before the 884 KB file of the timing census and its 1504 definitions.
 */

export const CENTRED_CLASS = 'html-centred';

/** The elements whose `align` GitHub honours on this route. */
const ALIGNED = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Bytes that may centre something: a cheap test before the bytes are parsed. */
const MAY_CENTRE = /<center[\s>]|\balign\s*=\s*["']?center/i;

/** Whether an element of the bytes is centred as GitHub draws it. */
function centres(element: Element): boolean {
  const name = element.tagName.toLowerCase();
  if (name === 'center') return true;
  return ALIGNED.has(name) && element.getAttribute('align')?.trim().toLowerCase() === 'center';
}

/**
 * Whether the bytes a block keeps centre all of it, as GitHub draws them:
 * every element at the top of the bytes is centred, and nothing else stands
 * there but white space and line breaks.
 *
 * The bytes of one block are one element, a wrapper or a heading. Bytes that
 * read back as several blocks, a region, may hold several elements; measured
 * on #699, 29 of the 49 centred regions of the corpus snapshot are several
 * elements each centred, drawn centred whole, and 1 is a centred heading
 * followed by a paragraph that is not, which GitHub draws half centred and
 * this draws at the left, as before. Parsed in a `template`, where nothing in
 * the bytes loads or runs (`inert-html.ts`).
 */
export function centresByItsHtml(source: string): boolean {
  if (!MAY_CENTRE.test(source)) return false;
  const top = inertTemplate(source).content.childNodes;
  let centred = 0;
  for (const node of top) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === '') continue;
    if (!(node instanceof Element)) return false;
    if (node.tagName.toLowerCase() === 'br') continue;
    if (!centres(node)) return false;
    centred += 1;
  }
  return centred > 0;
}

interface ReadCache {
  /** The reference definitions the reads were made with, as nodes. */
  definitions: readonly ProseMirrorNode[];
  reads: Map<string, ProseMirrorNode>;
  /** Whether the bytes centre their block, by bytes. */
  centring: Map<string, boolean>;
}

interface Candidate {
  readonly node: ProseMirrorNode;
  readonly pos: number;
  readonly parent: ProseMirrorNode;
  readonly index: number;
}

/** Whether two lists hold the same nodes; nodes are immutable, so the same node is the same text. */
function sameNodes(a: readonly ProseMirrorNode[], b: readonly ProseMirrorNode[]): boolean {
  return a.length === b.length && a.every((node, i) => node === b[i]);
}

/** The decorations for `doc`: a class on every block the save keeps centred. */
export function centredDecorations(
  doc: ProseMirrorNode,
  schema: Schema,
  cache: ReadCache,
): DecorationSet {
  // One walk, returning at every textblock, so it is bounded by the blocks.
  const candidates: Candidate[] = [];
  const definitions: ProseMirrorNode[] = [];
  const centring = new Map<string, boolean>();
  doc.descendants((node, pos, parent, index) => {
    if (isReferenceDefinition(node)) definitions.push(node);
    const source = node.attrs[HTML_BLOCK_SOURCE];
    if (typeof source === 'string' && parent !== null) {
      const centred =
        centring.get(source) ?? cache.centring.get(source) ?? centresByItsHtml(source);
      centring.set(source, centred);
      if (centred) candidates.push({ node, pos, parent, index });
    }
    return !node.isTextblock;
  });
  cache.centring = centring;
  // The definitions decide how bytes read; a change to them drops the reads.
  if (!sameNodes(definitions, cache.definitions)) cache.reads.clear();
  cache.definitions = definitions;
  let read: Reread | null = null;
  const used = new Map<string, ProseMirrorNode>();
  const cachedRead = (source: string): ProseMirrorNode => {
    const hit = used.get(source) ?? cache.reads.get(source);
    if (hit !== undefined) {
      used.set(source, hit);
      return hit;
    }
    read ??= rereadFor(doc, schema);
    const fresh = read(source);
    used.set(source, fresh);
    return fresh;
  };
  const decorations: Decoration[] = [];
  for (const { node, pos, parent, index } of candidates) {
    const region = uneditedRegionSize(node, parent, index, cachedRead);
    const end = region !== null ? pos + region : pos + node.nodeSize;
    if (region === null && !isUneditedHtmlBlock(node, schema, cachedRead)) continue;
    doc.nodesBetween(pos, end, (block, at) => {
      if (at < pos || !block.isBlock) return true;
      decorations.push(Decoration.node(at, at + block.nodeSize, { class: CENTRED_CLASS }));
      return false;
    });
  }
  // The reads of bytes the document no longer holds are let go.
  cache.reads = used;
  return DecorationSet.create(doc, decorations);
}

const key = new PluginKey<DecorationSet>('centredBlocks');

export const CentredBlocks = Extension.create({
  name: 'centredBlocks',

  addProseMirrorPlugins() {
    const schema = this.editor.schema;
    const cache: ReadCache = { definitions: [], reads: new Map(), centring: new Map() };
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => centredDecorations(state.doc, schema, cache),
          apply: (tr, previous, _old, state) =>
            tr.docChanged ? centredDecorations(state.doc, schema, cache) : previous,
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});
