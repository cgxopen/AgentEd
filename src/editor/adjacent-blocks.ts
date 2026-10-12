import { Extension } from '@tiptap/core';
import { ADJACENT_ATTRIBUTE } from './markdown/adjacency';

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
 * (#568), as one attribute on every block type at once.
 *
 * It follows the block (owner decision D3): a block moved, or given a new
 * block above it, keeps the flag, and the save decides whether the pair as
 * written still reads back. A block split by Enter gives its second half no
 * flag, so a block the editor makes is written a blank line apart, as every
 * block was before #568.
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
          parseHTML: (element: HTMLElement) => element.hasAttribute(ADJACENT_ATTRIBUTE),
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.adjacent === true ? { [ADJACENT_ATTRIBUTE]: '' } : {},
        },
      },
    },
  ],
});
