import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * A long run in a table cell may wrap anywhere, and nothing else in the table
 * may (#618, owner decision of 2026-10-19 on the stop of #624).
 *
 * A URL, a code span or a word of 400 characters with no space made its table
 * as wide as the run, and the whole document scrolled sideways. A table sizes
 * a column from the minimum width of its cells, which is the width of the
 * longest run they hold, and `overflow-wrap: break-word`, already on every
 * cell, does not lower it. `anywhere` does, and on the whole cell it lowered
 * it for every word: an options table of short code spans and a description
 * broke `timeout` and `boolean` mid-way, in a wide window too. So the rule
 * goes on the run itself, through the class this module decorates it with:
 * the cell narrows to its longest other word, and the words beside the run
 * stay whole.
 *
 * ── Which runs ──
 *
 * A run is the characters between two white spaces, across marks, so a URL
 * whose middle is bold is one run; an inline leaf, a hard break or an image,
 * ends one. It is long from `LONG_RUN` characters. Measured on the corpus
 * snapshot of 8361 files, in table cells: words reach 15 characters at the
 * p99 and 26 at the p99.9, and 47 of the 54 bare URLs are 32 or longer, the
 * other seven 16 or shorter. 30 is above the words and below the URLs. What
 * is marked besides them are identifiers, 85 words of 30 or more in 177874,
 * `FST_ERR_ROUTE_DUPLICATED_HANDLER`, and 843 code spans in 28338; they may
 * now break where a table needs the room, as a URL does.
 *
 * ── It is chrome, by construction ──
 *
 * A decoration exists nowhere in the document model, so it cannot reach the
 * file, as `footnote-hover.ts` records.
 */
export const longRunKey = new PluginKey<DecorationSet>('longRun');

/** The class the stylesheet lets wrap anywhere. */
export const LONG_RUN_CLASS = 'long-run';

/** The fewest characters of a run that is marked. */
export const LONG_RUN = 30;

/** The most runs marked in a document; past it the rest scroll as before. */
const RUN_LIMIT = 5000;

const TABLE_CELLS = new Set(['tableCell', 'tableHeader']);

/** The text of `block`, one character a position: a leaf is spaces, so it ends a run. */
function textOf(block: ProseMirrorNode): string {
  let text = '';
  block.forEach((child) => {
    text += child.isText ? (child.text ?? '') : ' '.repeat(child.nodeSize);
  });
  return text;
}

/** The long runs of `block`, a text block at `pos`, decorated; none outside a table cell. */
function runsOf(block: ProseMirrorNode, pos: number, parent: ProseMirrorNode | null): Decoration[] {
  if (parent === null || !TABLE_CELLS.has(parent.type.name)) return [];
  const decorations: Decoration[] = [];
  for (const match of textOf(block).matchAll(new RegExp(`\\S{${LONG_RUN},}`, 'g'))) {
    const from = pos + 1 + match.index;
    decorations.push(Decoration.inline(from, from + match[0].length, { class: LONG_RUN_CLASS }));
  }
  return decorations;
}

/** The long runs of every text block inside a table cell, decorated: the walk of a load. */
export function longRunDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (decorations.length >= RUN_LIMIT) return false;
    if (!node.isTextblock) return !node.isLeaf;
    decorations.push(...runsOf(node, pos, parent));
    return false;
  });
  return DecorationSet.create(doc, decorations.slice(0, RUN_LIMIT));
}

/** The most ranges of one transaction redone one by one; past it, the whole walk. */
const RANGE_LIMIT = 50;

/** The ranges `tr` changed, in the coordinates of the document it ends with. */
function changedRanges(tr: Transaction): [number, number][] | null {
  const ranges: [number, number][] = [];
  const maps = tr.mapping.maps;
  for (let i = 0; i < maps.length; i += 1) {
    maps[i].forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const rest = tr.mapping.slice(i + 1);
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
    if (ranges.length > RANGE_LIMIT) return null;
  }
  return ranges;
}

/**
 * The set after `tr`. Since a keystroke changes one text block, the set is
 * mapped through the transaction and only the text blocks it touched are read
 * again; the decorations of a block are always the runs of that block alone,
 * so reading one again never needs another. A transaction touching more than
 * `RANGE_LIMIT` places, a load or a paste across the document, takes the walk.
 */
export function longRunsAfter(tr: Transaction, set: DecorationSet): DecorationSet {
  if (!tr.docChanged) return set;
  const ranges = changedRanges(tr);
  if (ranges === null) return longRunDecorations(tr.doc);
  let next = set.map(tr.mapping, tr.doc);
  const size = tr.doc.content.size;
  for (const [from, to] of ranges) {
    tr.doc.nodesBetween(Math.max(0, from - 1), Math.min(size, to + 1), (node, pos, parent) => {
      if (!node.isTextblock) return !node.isLeaf;
      next = next.remove(next.find(pos, pos + node.nodeSize));
      next = next.add(tr.doc, runsOf(node, pos, parent));
      return false;
    });
  }
  return next;
}

/** Plugin state, so a selection change costs nothing, as #215 asks. */
export function createLongRunPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: longRunKey,
    state: {
      init: (_config, state) => longRunDecorations(state.doc),
      apply: (tr, value) => longRunsAfter(tr, value),
    },
    props: {
      decorations(state) {
        return longRunKey.getState(state);
      },
    },
  });
}

export const LongRun = Extension.create({
  name: 'longRun',
  addProseMirrorPlugins() {
    return [createLongRunPlugin()];
  },
});
