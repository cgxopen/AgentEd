import { Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { isReplacingDocument } from './document-load';
import {
  decodeWhitespace,
  encodeWhitespace,
  SOFT_BREAK_ATTRIBUTE,
  SOFT_BREAK_INDENT_ATTRIBUTE,
  SOFT_BREAK_SPACE_ATTRIBUTE,
} from './markdown/soft-break';

/**
 * A line break inside a paragraph, as the file wrote it (#571). See
 * `markdown/soft-break.ts` for the route and the owner decision.
 *
 * **Drawn as a space, read as a space.** The element holds one space, so the
 * paragraph reads as it did before #571; `leafText` makes every reader of the
 * document text, the word and token counts and a plain-text copy among them,
 * take it as one space too, and `renderText` does the same for TipTap.
 *
 * **An atom**, so the caret steps over it as over one character and a
 * Backspace or a Delete beside it removes it, joining the two words, as it
 * would remove a space. Typing beside it leaves it where it is, so the lines of
 * a paragraph keep their wraps around an edit.
 */

const SOFT_BREAK = 'softBreak';

/** One of the two whitespace attributes: read from the element, rendered only when not empty. */
function whitespaceAttribute(name: 'space' | 'indent', attribute: string) {
  return {
    default: '',
    parseHTML: (element: HTMLElement) => decodeWhitespace(element.getAttribute(attribute)),
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[name];
      return typeof value === 'string' && value !== ''
        ? { [attribute]: encodeWhitespace(value) }
        : {};
    },
  };
}

/**
 * The positions of the soft breaks that stand first or last in a textblock
 * the transactions touched (item 3 of the decision), last first. Enter beside
 * a break leaves it at the edge of one of the two paragraphs, where it would
 * draw a space before the first word or after the last and write nothing. A
 * file puts one there only between raw HTML tags on lines of their own, and a
 * load is not an edit, so those stay.
 *
 * Only the ranges the steps changed are walked, each mapped into `doc`, so the
 * cost follows the size of the edit and not of the document.
 */
function edgeBreaks(transactions: readonly Transaction[], doc: ProseMirrorNode): number[] {
  const maps = transactions.flatMap((tr) => tr.mapping.maps);
  const mapping = new Mapping(maps);
  const found = new Set<number>();
  maps.forEach((map, index) => {
    const after = mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = Math.max(0, after.map(newStart, -1) - 1);
      const to = Math.min(doc.content.size, after.map(newEnd, 1) + 1);
      doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        if (node.firstChild?.type.name === SOFT_BREAK) found.add(pos + 1);
        if (node.lastChild?.type.name === SOFT_BREAK) found.add(pos + node.content.size);
        return false;
      });
    });
  });
  return [...found].sort((a, b) => b - a);
}

export const SoftBreak = Node.create({
  name: SOFT_BREAK,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes: () => ({
    space: whitespaceAttribute('space', SOFT_BREAK_SPACE_ATTRIBUTE),
    indent: whitespaceAttribute('indent', SOFT_BREAK_INDENT_ATTRIBUTE),
  }),

  parseHTML: () => [{ tag: `span[${SOFT_BREAK_ATTRIBUTE}]` }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    { [SOFT_BREAK_ATTRIBUTE]: '', ...HTMLAttributes },
    ' ',
  ],
  renderText: () => ' ',

  // ProseMirror's own readers of the document text, `textContent` and the
  // clipboard among them, ask the spec rather than TipTap.
  extendNodeSchema(extension) {
    return extension.name === SOFT_BREAK ? { leafText: () => ' ' } : {};
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('softBreakEdges'),
        appendTransaction(transactions, _old, state) {
          // A load is left as the file wrote it: a paragraph of raw HTML tags
          // on several lines holds a break at an edge, and the bytes kept for
          // it are compared with the paragraph as loaded (#468, #563).
          if (isReplacingDocument() || !transactions.some((tr) => tr.docChanged)) return null;
          const positions = edgeBreaks(transactions, state.doc);
          if (positions.length === 0) return null;
          const tr = state.tr;
          // Last first, so each deletion leaves the positions before it in place.
          for (const pos of positions) tr.delete(pos, pos + 1);
          return tr;
        },
      }),
    ];
  },
});
