/**
 * The seven Table routes (#292), at the level the user meets them.
 *
 * **All of this is state and bytes, which the harness sees in full.** Every row
 * drives the same object `main.ts` spreads into `setupMenu`, over a real
 * editor, and reads the markdown a save would write. What the harness cannot
 * see is the menu itself — the greyed entries on screen, the height of the
 * section, the focus after a press — and that is named in the pull request as
 * the manual pass rather than implied here.
 *
 * **Why the rows carry distinct text in every row and column.** Measured on the
 * step zero: Add Row Above against Add Row Below, and Add Column Before against
 * Add Column After, leave **12 cells against 12** on a three by three table, and
 * Delete Row against Delete Column leaves **6 against 6** — so a row that counts
 * cells sees none of the three swaps. The fixtures below spell a1, a2, a3 and
 * so on, and the assertions are on the written bytes, where each swap shows.
 */
import { describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';
import { tableShapeAvailability, tableShapeMenuCallbacks } from './table-shape';

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** The caret just after the first occurrence of `text`, the way a click leaves it. */
function caretIn(instance: EditorInstance, text: string): void {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText || node.text === undefined) return found < 0;
    const at = node.text.indexOf(text);
    if (at >= 0) found = pos + at + text.length;
    return false;
  });
  if (found < 0) throw new Error(`"${text}" is not in the document`);
  instance.editor.commands.setTextSelection(found);
}

/** The entries the menu would hold, for an editor with the caret already placed. */
function routes(instance: EditorInstance) {
  return tableShapeMenuCallbacks(instance.editor);
}

/** The keys of the entries that can be chosen, in the order the section lists them. */
function offered(instance: EditorInstance): string[] {
  const availability = tableShapeAvailability(instance.editor);
  return Object.entries(availability)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

const EVERY_ENTRY = [
  'addRowAbove',
  'addRowBelow',
  'deleteRow',
  'addColumnBefore',
  'addColumnAfter',
  'deleteColumn',
  'deleteTable',
];

/** What the document reads back as, so a file that disagrees with the screen shows. */
function grid(instance: EditorInstance): string {
  const tables: string[] = [];
  instance.editor.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true;
    const rows: string[] = [];
    node.forEach((row) => {
      const cells: string[] = [];
      row.forEach((cell) => {
        cells.push(`${cell.type.name === 'tableHeader' ? 'TH' : 'td'}:${cell.textContent}`);
      });
      rows.push(cells.join(','));
    });
    tables.push(`{${rows.join(' / ')}}`);
    return true;
  });
  return tables.join(' + ');
}

/**
 * A round trip of the document as it now stands: the bytes a save writes, the
 * grid a fresh editor reads back from them, and the bytes the next save writes.
 */
function roundTrip(instance: EditorInstance): {
  written: string;
  readsBack: boolean;
  holdsStill: boolean;
} {
  const written = instance.getMarkdown();
  const reopened = editorWith(written);
  const result = {
    written,
    readsBack: grid(reopened) === grid(instance),
    holdsStill: reopened.getMarkdown() === written,
  };
  reopened.destroy();
  return result;
}

const HUGGED = '| h1 | h2 | h3 |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |';
const ALIGNED = '| h1 | h2 | h3 |\n| :--- | :---: | ---: |\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |';
const PADDED =
  '| h1   | h2   | h3   |\n| :--- | :--: | ---: |\n| a1   | a2   | a3   |\n| b1   | b2   | b3   |';
/** A table inside a cell, written as inline HTML (#278). */
const INNER =
  '| h1 | h2 |\n| --- | --- |\n| <table><tr><th>i1</th><th>i2</th></tr><tr><td>x1</td><td>x2</td></tr></table> | a2 |';
/** An inner table with no header row and one row: the last row, with no header rule in the way. */
const INNER_ONE_ROW = '| h1 |\n| --- |\n| <table><tr><td>x1</td><td>x2</td></tr></table> |';
const ONE_COLUMN = '| h1 |\n| --- |\n| a1 |\n| b1 |';
/** A table the file wrote as raw HTML, kept as its own bytes until it is edited (#283). */
const KEPT_HTML =
  'before\n\n<table>\n<caption>Cap</caption>\n<tr><th align="right">r1</th><th style="text-align: center">r2</th><th>r3</th></tr>\n<tr><td colspan="2">wide</td><td>c</td></tr>\n<tr><td>d1</td><td>d2</td><td>d3</td></tr>\n</table>';

// ─────────────────────────────────────────────────────────────────────────────
// Which entries are offered, which is what the menu greys from
// ─────────────────────────────────────────────────────────────────────────────

describe('what the Table section offers, where the caret is (#292)', () => {
  it('offers nothing outside a table', () => {
    const instance = editorWith('a paragraph\n\n| h1 |\n| --- |\n| a1 |');
    caretIn(instance, 'paragraph');

    expect(offered(instance)).toEqual([]);
  });

  it('offers all seven in a body cell', () => {
    const instance = editorWith(HUGGED);
    caretIn(instance, 'a2');

    expect(offered(instance)).toEqual(EVERY_ENTRY);
  });

  /**
   * h1, the owner decision of 2026-09-17. Both were measured writing a document
   * the editor did not show: a row added above the header is written *as* the
   * header and the old one demoted, and deleting the header promotes a1.
   */
  it('refuses Add Row Above and Delete Row in a GFM header row', () => {
    const instance = editorWith(HUGGED);
    caretIn(instance, 'h2');

    expect(offered(instance)).toEqual([
      'addRowBelow',
      'addColumnBefore',
      'addColumnAfter',
      'deleteColumn',
      'deleteTable',
    ]);
  });

  /**
   * The last row, with no header rule in the way, so the rule is asserted on its
   * own. **This is the case `editor.can()` answers wrongly**: measured at
   * `82f2d05`, `can().deleteRow()` is `true` here and the command then returns
   * `false`, because `prosemirror-tables` tests the last row inside
   * `if (dispatch)`. An entry greyed from `can()` would press silently.
   */
  it('refuses Delete Row on the last row of a table with no header row', () => {
    const instance = editorWith(INNER_ONE_ROW);
    caretIn(instance, 'x1');

    expect(instance.editor.can().deleteRow()).toBe(true);
    expect(offered(instance)).not.toContain('deleteRow');
    expect(offered(instance)).toContain('addRowAbove');
  });

  /** The last column, the other case `can()` answers wrongly for the same reason. */
  it('refuses Delete Column on the last column', () => {
    const instance = editorWith(ONE_COLUMN);
    caretIn(instance, 'a1');

    expect(instance.editor.can().deleteColumn()).toBe(true);
    expect(offered(instance)).not.toContain('deleteColumn');
    expect(offered(instance)).toContain('addColumnBefore');
  });

  /**
   * **The refusal is stricter than it needs to be inside an inner table, and
   * that is the decision rather than an accident** (owner, 2026-09-17). An
   * inner table is written as inline HTML, which can spell a header cell
   * anywhere, so both routes would read back here — the second half of this row
   * measures exactly that, by running the command the entry refuses and showing
   * the file agreeing with the screen. One rule that reads the same in both
   * tables was preferred to two rules that differ by where the caret is.
   */
  it('refuses the same two in an inner header row, where the file could in fact hold them', () => {
    const instance = editorWith(INNER);
    caretIn(instance, 'i1');
    expect(offered(instance)).not.toContain('addRowAbove');
    expect(offered(instance)).not.toContain('deleteRow');

    instance.editor.commands.deleteRow();

    const trip = roundTrip(instance);
    expect(trip.readsBack).toBe(true);
    expect(trip.holdsStill).toBe(true);
  });

  it('offers the entries of the innermost table, which is the one the commands act on', () => {
    const instance = editorWith(INNER);
    caretIn(instance, 'x1');

    // The inner table has two rows and two columns of its own, so both deletes
    // are offered there while the caret sits in a cell of the outer table too.
    expect(offered(instance)).toEqual(EVERY_ENTRY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What each route writes
// ─────────────────────────────────────────────────────────────────────────────

describe('the row routes write what the file can read back (#292)', () => {
  it('adds a row above the caret row', () => {
    const instance = editorWith(HUGGED);
    caretIn(instance, 'b1');

    routes(instance).onAddRowAbove();

    const trip = roundTrip(instance);
    expect(trip.written).toBe(
      '| h1 | h2 | h3 |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n|  |  |  |\n| b1 | b2 | b3 |',
    );
    expect(trip.readsBack).toBe(true);
    expect(trip.holdsStill).toBe(true);
  });

  it('adds a row below the caret row', () => {
    const instance = editorWith(HUGGED);
    caretIn(instance, 'a1');

    routes(instance).onAddRowBelow();

    const trip = roundTrip(instance);
    expect(trip.written).toBe(
      '| h1 | h2 | h3 |\n| --- | --- | --- |\n| a1 | a2 | a3 |\n|  |  |  |\n| b1 | b2 | b3 |',
    );
    expect(trip.readsBack).toBe(true);
    expect(trip.holdsStill).toBe(true);
  });

  it('deletes the caret row', () => {
    const instance = editorWith(HUGGED);
    caretIn(instance, 'a3');

    routes(instance).onDeleteRow();

    const trip = roundTrip(instance);
    expect(trip.written).toBe('| h1 | h2 | h3 |\n| --- | --- | --- |\n| b1 | b2 | b3 |');
    expect(trip.readsBack).toBe(true);
    expect(trip.holdsStill).toBe(true);
  });

  it('deletes the whole table, leaving the text around it', () => {
    const instance = editorWith(`before\n\n${HUGGED}\n\nafter`);
    caretIn(instance, 'a1');

    routes(instance).onDeleteTable();

    const trip = roundTrip(instance);
    expect(trip.written).toBe('before\n\nafter');
    expect(trip.holdsStill).toBe(true);
  });

  it('adds a row below the last row, where Tab already adds one, and writes the same document', () => {
    const byTab = editorWith(HUGGED);
    caretIn(byTab, 'b3');
    const { view } = byTab.editor;
    const handled = view.someProp('handleKeyDown', (handler) =>
      handler(view, new KeyboardEvent('keydown', { key: 'Tab' })),
    );
    const byRoute = editorWith(HUGGED);
    caretIn(byRoute, 'b3');

    routes(byRoute).onAddRowBelow();

    expect(handled).toBe(true);
    expect(byRoute.getMarkdown()).toBe(byTab.getMarkdown());
  });
});

describe('a column route takes the spelling of the column with it (#292, c1)', () => {
  it('keeps every alignment when a column is added at the left edge', () => {
    const instance = editorWith(ALIGNED);
    caretIn(instance, 'a1');

    routes(instance).onAddColumnBefore();

    const trip = roundTrip(instance);
    expect(trip.written).toBe(
      '|  | h1 | h2 | h3 |\n| --- | :--- | :---: | ---: |\n|  | a1 | a2 | a3 |\n|  | b1 | b2 | b3 |',
    );
    expect(trip.readsBack).toBe(true);
    expect(trip.holdsStill).toBe(true);
  });

  it('keeps every alignment when a column is added in the middle', () => {
    const instance = editorWith(ALIGNED);
    caretIn(instance, 'a1');

    routes(instance).onAddColumnAfter();

    expect(instance.getMarkdown()).toBe(
      '| h1 |  | h2 | h3 |\n| :--- | --- | :---: | ---: |\n| a1 |  | a2 | a3 |\n| b1 |  | b2 | b3 |',
    );
  });

  it('keeps the alignment of the columns that remain when one is deleted', () => {
    const instance = editorWith(ALIGNED);
    caretIn(instance, 'a2');

    routes(instance).onDeleteColumn();

    const trip = roundTrip(instance);
    expect(trip.written).toBe('| h1 | h3 |\n| :--- | ---: |\n| a1 | a3 |\n| b1 | b3 |');
    expect(trip.readsBack).toBe(true);
    expect(trip.holdsStill).toBe(true);
  });

  it('keeps the padded widths of a hand-aligned table, which shift the same way', () => {
    const instance = editorWith(PADDED);
    caretIn(instance, 'a2');

    routes(instance).onDeleteColumn();

    const trip = roundTrip(instance);
    expect(trip.written).toBe('| h1   | h3   |\n| :--- | ---: |\n| a1   | a3   |\n| b1   | b3   |');
    expect(trip.holdsStill).toBe(true);
  });

  it('writes a hugged table the way it was written before, with no alignment invented', () => {
    const instance = editorWith(HUGGED);
    caretIn(instance, 'a1');

    routes(instance).onAddColumnBefore();

    expect(instance.getMarkdown()).toBe(
      '|  | h1 | h2 | h3 |\n| --- | --- | --- | --- |\n|  | a1 | a2 | a3 |\n|  | b1 | b2 | b3 |',
    );
  });

  /**
   * **What c1 does not reach, asserted so it is a measured limit rather than a
   * claim.** A table with no spelling of its own inherits the first spelled
   * table in the document through `styleFor`, and the attribute the route moves
   * is not on that node — so on that table alone a column route still shifts
   * the alignment. Recorded on #292 as the known hole; repairing it means
   * writing an attribute onto a table the file never spelled, which is a change
   * of its own.
   */
  it('still shifts the alignment a table inherits from a neighbour, which is out of scope', () => {
    const instance = editorWith(`${ALIGNED}\n\ntext\n\n| n1 | n2 | n3 |\n| --- | --- | --- |`);
    // A table the editor made has no spelling; this one gets there by having
    // its own stripped, which is the state Insert Table leaves behind.
    instance.editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'table' || node.textContent.indexOf('n1') !== 0) return true;
      instance.editor.view.dispatch(
        instance.editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          tableStyle: null,
        }),
      );
      return false;
    });
    expect(instance.getMarkdown().endsWith('| n1 | n2 | n3 |\n| :--- | :---: | ---: |')).toBe(true);
    caretIn(instance, 'n1');

    routes(instance).onAddColumnBefore();

    expect(
      instance.getMarkdown().endsWith('|  | n1 | n2 | n3 |\n| :--- | :---: | ---: | --- |'),
    ).toBe(true);
  });
});

describe('a route refused by the greyed state changes nothing (#292, #275)', () => {
  it.each([
    ['onAddRowAbove', 'h1', HUGGED],
    ['onDeleteRow', 'h1', HUGGED],
    ['onDeleteColumn', 'a1', ONE_COLUMN],
  ] as const)('%s pressed at %s writes the same bytes', (route, anchor, markdown) => {
    const instance = editorWith(markdown);
    caretIn(instance, anchor);

    routes(instance)[route]();

    expect(instance.getMarkdown()).toBe(markdown);
  });

  it('does nothing at all with the caret outside a table', () => {
    const instance = editorWith(`a paragraph\n\n${HUGGED}`);
    caretIn(instance, 'paragraph');
    const entries = routes(instance);

    entries.onAddRowBelow();
    entries.onAddColumnAfter();
    entries.onDeleteTable();

    expect(instance.getMarkdown()).toBe(`a paragraph\n\n${HUGGED}`);
  });
});

describe('every route is one press of undo (#292, R-C16)', () => {
  it.each([
    ['onAddRowAbove', 'a1'],
    ['onAddRowBelow', 'a1'],
    ['onDeleteRow', 'a1'],
    ['onAddColumnBefore', 'a1'],
    ['onAddColumnAfter', 'a1'],
    ['onDeleteColumn', 'a2'],
    ['onDeleteTable', 'a1'],
  ] as const)('%s, undone once, gives the bytes back', (route, anchor) => {
    const instance = editorWith(ALIGNED);
    caretIn(instance, anchor);
    routes(instance)[route]();
    expect(instance.getMarkdown()).not.toBe(ALIGNED);

    instance.editor.commands.undo();

    expect(instance.getMarkdown()).toBe(ALIGNED);
  });
});

describe('the tables a route must not reach past (#278, #283)', () => {
  it('changes the inner table and leaves the outer one alone', () => {
    const instance = editorWith(INNER);
    caretIn(instance, 'x1');

    routes(instance).onAddColumnAfter();

    const trip = roundTrip(instance);
    expect(trip.written).toBe(
      '| h1 | h2 |\n| --- | --- |\n| <table><tr><th>i1</th><th></th><th>i2</th></tr><tr><td>x1</td><td></td><td>x2</td></tr></table> | a2 |',
    );
    expect(trip.readsBack).toBe(true);
    expect(trip.holdsStill).toBe(true);
  });

  /**
   * A table the file wrote as raw HTML is written back as its own bytes while
   * it is unedited (#283). **A route edits it exactly as typing does**: the
   * same GFM, the same loss, and one press of undo gives the bytes back. The
   * loss itself is #283 and is unchanged here — what this row holds is that a
   * new route neither widens it nor escapes the undo.
   */
  it('writes GFM from a kept HTML table, the way one typed character does', () => {
    const typed = editorWith(KEPT_HTML);
    caretIn(typed, 'd1');
    typed.editor.commands.insertContent('X');
    const byTyping = typed.getMarkdown().replace('d1X', 'd1');

    const instance = editorWith(KEPT_HTML);
    caretIn(instance, 'd1');
    routes(instance).onAddRowBelow();
    const byRoute = instance.getMarkdown().replace('\n|  |  |  |', '');

    expect(byRoute).toBe(byTyping);

    instance.editor.commands.undo();
    expect(instance.getMarkdown()).toBe(KEPT_HTML);
  });
});
