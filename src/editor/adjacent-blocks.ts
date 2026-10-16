import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { ADJACENT_ATTRIBUTE, MAX_RUN } from './markdown/adjacency';
import { HEADING_SPELLING_UNSET } from './markdown/heading-spelling';

/**
 * The node types that can stand directly under another block in a file:
 * the ten R-C2 names for the top level, which are also what a quote and a
 * list item hold. A reference definition rides on `footnoteDefinition`
 * (#570). Measured on the step zero of #568: of the 22 node types of the
 * schema, these are the blocks; the others are the document, inline nodes,
 * and the items, rows and cells a container owns.
 */
export const ADJACENT_BLOCK_TYPES: readonly string[] = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'horizontalRule',
  'table',
  'footnoteDefinition',
];

/**
 * Whether the file wrote this block directly under the block above it
 * (#568), or a run of blank lines above it (#590), as one attribute on every
 * block type at once: `true` for no blank line, a number from 2 up for a run,
 * and `false`, the default, for the one blank line a block is written with.
 *
 * It follows the block (owner decision D3): a block moved, or given a new
 * block above it, keeps the flag, and the save decides whether the pair as
 * written still reads back. A block split by Enter gives its second half no
 * flag, wherever the caret stands, so a block the editor makes is written a
 * blank line apart, as every block was before #568.
 *
 * `keepOnSplit: false` covers the end of a block alone: TipTap 2.27.3 passes
 * the split attributes to `splitBlock` only when the caret is at the end, and
 * elsewhere `tr.split` copies the node with every attribute, measured on the
 * step zero of #590 for a paragraph, a heading, a quote and a list item
 * (#594). The plugin below covers the rest.
 */
export const AdjacentBlocks = Extension.create({
  name: 'adjacentBlocks',
  addGlobalAttributes: () => [
    {
      types: [...ADJACENT_BLOCK_TYPES],
      attributes: {
        adjacent: {
          default: false,
          keepOnSplit: false,
          parseHTML: (element: HTMLElement) =>
            adjacencyOf(element.getAttribute(ADJACENT_ATTRIBUTE)),
          renderHTML: (attributes: Record<string, unknown>) => {
            const { adjacent } = attributes;
            if (adjacent === true) return { [ADJACENT_ATTRIBUTE]: '' };
            return typeof adjacent === 'number' ? { [ADJACENT_ATTRIBUTE]: String(adjacent) } : {};
          },
        },
      },
    },
  ],
  addProseMirrorPlugins: () => [secondHalfWithoutFlag()],
});

/** The attribute value as the node holds it: absent, empty, or a count of 2 up. */
function adjacencyOf(value: string | null): boolean | number {
  if (value === null) return false;
  if (!/^\d+$/.test(value)) return true;
  const count = Number(value);
  return count >= 2 ? Math.min(count, MAX_RUN) : true;
}

const secondHalfKey = new PluginKey('adjacentBlocksSecondHalf');

/**
 * Whether a step is a split: nothing replaced, and a slice that closes and
 * reopens the same depth of blocks, as `tr.split` writes it for `splitBlock`
 * and `splitListItem` alike. A paste of several blocks into the middle of
 * one has the same shape, and the trailing part it leaves is a new block too.
 * A block moved whole is a slice open on neither side, so it keeps its flag.
 */
function isSplit(step: unknown): step is ReplaceStep {
  if (!(step instanceof ReplaceStep)) return false;
  const { from, to, slice } = step;
  return (
    from === to &&
    slice.openStart > 0 &&
    slice.openStart === slice.openEnd &&
    slice.content.childCount >= 2
  );
}

/**
 * Where each split of these transactions opened its new blocks, in the
 * document they end with: the range a split inserted, mapped through every
 * step after it. Bounded by the steps of the transactions.
 */
function splitRanges(transactions: readonly Transaction[]): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  transactions.forEach((tr, t) => {
    tr.steps.forEach((step, i) => {
      if (!isSplit(step)) return;
      let from = step.from;
      let to = step.from + step.slice.size;
      const later = [
        tr.mapping.slice(i + 1),
        ...transactions.slice(t + 1).map((next) => next.mapping),
      ];
      for (const mapping of later) {
        from = mapping.map(from, -1);
        to = mapping.map(to, 1);
      }
      ranges.push({ from, to });
    });
  });
  return ranges;
}

/**
 * The second half of a split loses the flag, whatever it held (#594): the
 * block starting inside the range a split opened is the new one, and the
 * first half starts before it. The count of #590 rides on the same attribute
 * and is cleared by the same step, and so is the spelling of a heading (#573),
 * which `tr.split` copies the same way.
 */
function secondHalfWithoutFlag(): Plugin {
  return new Plugin({
    key: secondHalfKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const ranges = splitRanges(transactions);
      if (ranges.length === 0) return null;
      const tr = newState.tr;
      for (const { from, to } of ranges) {
        newState.doc.nodesBetween(from, Math.min(to, newState.doc.content.size), (node, pos) => {
          if (pos < from || pos >= to) return true;
          if ('adjacent' in node.attrs && node.attrs.adjacent !== false) {
            tr.setNodeAttribute(pos, 'adjacent', false);
          }
          for (const [name, unset] of Object.entries(HEADING_SPELLING_UNSET)) {
            if (name in node.attrs && node.attrs[name] !== unset)
              tr.setNodeAttribute(pos, name, unset);
          }
          return true;
        });
      }
      return tr.steps.length > 0 ? tr : null;
    },
  });
}
