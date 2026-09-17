import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import { type ColumnStyle, decodeTableStyle } from './markdown/table-style';

/**
 * The shape of a table, as the seven entries of the Table section (#292).
 *
 * The extension exposes nineteen table commands and seventeen reached no route
 * before this. **Seven of them are routed here, and which seven was decided by
 * the round trip rather than by what the extension can do**, measured at
 * `82f2d05` on five fixtures — a GFM table in each of the three spellings #93
 * keeps, an inner table written as inline HTML in a cell (#278), and a raw HTML
 * table kept as its own bytes (#283):
 *
 * - `addRowBefore`, `addRowAfter`, `deleteRow`, `deleteTable` and the three
 *   column commands read back and hold still everywhere they are offered.
 * - **`mergeCells`, `splitCell` and the three header toggles stay unrouted.**
 *   A merge writes no span: the merged cell is written as its two paragraphs,
 *   the cells beside it move under other headers, and an empty cell is
 *   appended. The three toggles are discarded in silence on a GFM table — the
 *   editor shows the change, the file keeps what was removed, and the document
 *   reads back with the header. Owner decision, 2026-09-17.
 *
 * **What a route must never do is press silently** (the #275 shape), so every
 * entry that would do nothing is greyed instead — see `tableShapeAvailability`
 * below, which is both what the menu reads and what each route asks before it
 * acts, so the greyed state and the refusal cannot drift apart.
 */

/** The seven entries, as the mapping from entry to command. */
export interface TableShapeMenuCallbacks {
  readonly onAddRowAbove: () => void;
  readonly onAddRowBelow: () => void;
  readonly onDeleteRow: () => void;
  readonly onAddColumnBefore: () => void;
  readonly onAddColumnAfter: () => void;
  readonly onDeleteColumn: () => void;
  readonly onDeleteTable: () => void;
}

/**
 * Which of the seven can be chosen where the caret is.
 *
 * A type rather than an interface, deliberately: the menu reads this as a
 * record keyed by entry, and only a type alias carries the implicit index
 * signature that assignment needs.
 */
export type TableShapeAvailability = {
  readonly addRowAbove: boolean;
  readonly addRowBelow: boolean;
  readonly deleteRow: boolean;
  readonly addColumnBefore: boolean;
  readonly addColumnAfter: boolean;
  readonly deleteColumn: boolean;
  readonly deleteTable: boolean;
};

/** Nothing is offered outside a table, which is the common case. */
const NOTHING: TableShapeAvailability = {
  addRowAbove: false,
  addRowBelow: false,
  deleteRow: false,
  addColumnBefore: false,
  addColumnAfter: false,
  deleteColumn: false,
  deleteTable: false,
};

/** Where the caret is, in the table it is in. */
interface CaretInTable {
  /** The table node, and where the document holds it. */
  readonly table: ProseMirrorNode;
  readonly tablePos: number;
  /** The cell's place in the grid, counted through `TableMap`. */
  readonly row: number;
  readonly column: number;
  readonly rows: number;
  readonly columns: number;
  /** Whether the first row of this table is a header row. */
  readonly headerRow: boolean;
}

/**
 * The table the caret is in, read as the **innermost** one.
 *
 * That is what the commands themselves act on: measured over 26 runs on #292,
 * no command acts on the outer table while the caret is in an inner one, and
 * `deleteTable` empties the inner cell rather than the document. So a route
 * reading the outer table would grey its entries against a table the command
 * would not touch.
 *
 * The walk is over the depths of one resolved position, from the innermost
 * outwards, so it is bounded by the depth of that position.
 */
function caretInTable(editor: Editor): CaretInTable | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== 'table') continue;
    const table = $from.node(depth);
    const tablePos = $from.before(depth);
    let cellDepth = -1;
    for (let inner = $from.depth; inner > depth; inner -= 1) {
      const name = $from.node(inner).type.name;
      if (name === 'tableCell' || name === 'tableHeader') cellDepth = inner;
    }
    // A position inside a table but in no cell of it is not a shape a
    // document can hold; it is refused rather than guessed at.
    if (cellDepth < 0) return null;
    const map = TableMap.get(table);
    const cell = map.findCell($from.before(cellDepth) - (tablePos + 1));
    return {
      table,
      tablePos,
      row: cell.top,
      column: cell.left,
      rows: map.height,
      columns: map.width,
      headerRow: table.firstChild?.firstChild?.type.name === 'tableHeader',
    };
  }
  return null;
}

/**
 * Which entries can be chosen, computed from the document.
 *
 * **It is computed here rather than asked of `editor.can()`, and that is a
 * measurement rather than a preference.** `prosemirror-tables` puts the
 * last-row and last-column refusals of `deleteRow` and `deleteColumn`
 * *inside* `if (dispatch)`, and returns `true` when there is no dispatch —
 * which is exactly how `can()` runs a command. Measured at `82f2d05`:
 * `editor.can().deleteRow()` answers `true` on a header-only table where the
 * command then answers `false`, and `editor.can().deleteColumn()` answers
 * `true` on a one-column table. An entry greyed from `can()` would be
 * enabled over nothing in both cases.
 *
 * The four rules, and what each is for:
 *
 * - **Outside a table, nothing.** There is no table to change.
 * - **In a GFM header row, Add Row Above and Delete Row are refused.** GFM
 *   requires a header, so the file cannot hold what either would produce: a
 *   row added above the header is written *as* the header and the old one is
 *   demoted, and deleting the header promotes the first body row. Both were
 *   measured writing a document the editor did not show. Owner decision
 *   (h1), 2026-09-17.
 * - **The last row and the last column are refused**, because the command
 *   refuses them itself and would press silently.
 * - **Delete Table is offered wherever a table is**, and it is the one route
 *   that takes a table out of the document.
 *
 * **On an inner table the header refusal is stricter than it needs to be**,
 * and that is accepted rather than special-cased (owner decision, 2026-09-17):
 * an inner table is written as inline HTML, which can spell a header cell
 * anywhere, so both routes would in fact read back there. One rule that reads
 * the same in both tables was preferred to two rules that differ by where the
 * caret happens to be. `table-shape.test.ts` asserts it so it reads as a
 * decision rather than as an oversight.
 */
export function tableShapeAvailability(editor: Editor): TableShapeAvailability {
  const caret = caretInTable(editor);
  if (!caret) return NOTHING;
  const inHeaderRow = caret.headerRow && caret.row === 0;
  return {
    addRowAbove: !inHeaderRow,
    addRowBelow: true,
    deleteRow: !inHeaderRow && caret.rows > 1,
    addColumnBefore: true,
    addColumnAfter: true,
    deleteColumn: caret.columns > 1,
    deleteTable: true,
  };
}

/**
 * A column the file never spelled: cells hugged, a spaced three-dash
 * separator. It is what `DEFAULT_TABLE_STYLE` says a table with no spelling of
 * its own is written with, one column at a time — a new column has no
 * alignment, because nothing in the document says what its alignment would be.
 */
const NEW_COLUMN: ColumnStyle = { kind: 'hug', width: 0, separator: ' --- ' };

/**
 * The column list of `current`, with one column inserted at or removed from
 * `column`, or `current` unchanged when there is no spelling to move.
 */
function styleWithColumnMoved(
  current: string | null,
  operation: 'before' | 'after' | 'delete',
  column: number,
): string | null {
  const style = decodeTableStyle(current);
  if (!style || style.columns.length === 0) return current;
  const columns = [...style.columns];
  if (operation === 'delete') columns.splice(column, 1);
  else columns.splice(operation === 'before' ? column : column + 1, 0, NEW_COLUMN);
  return JSON.stringify({ columns, emptyCell: style.emptyCell });
}

/**
 * A column route: the command, and the spelling that describes the columns,
 * in **one transaction** (#292, candidate c1).
 *
 * The spelling a table was written in rides on the table node as a list of
 * columns **by index** — alignment and padded width, one entry each (#93). So
 * the command alone leaves the list where it was while the columns move under
 * it: measured at `82f2d05`, `addColumnBefore` at the first column of a table
 * written `| :--- | :---: | ---: |` wrote `| :--- | :---: | ---: | --- |`, and
 * the rightmost column lost its alignment while the file held still. **A file
 * that renders differently from what the user had is the shape #300 put into
 * R-C2**, and it is repaired here by moving the list with the columns.
 *
 * **One chain, so one transaction, so one press of undo.** Measured 12 of 12
 * across the three spellings at the left edge, the middle and the right edge:
 * the bytes come back exactly. Two transactions would have cost a second press
 * that undid a spelling nobody could see change.
 *
 * The column index is read **before** the chain: `focus` does not move the
 * selection and the command needs the index the caret had, not the one it
 * leaves behind. The table position is read again inside the transaction
 * rather than trusted, because a route that wrote a spelling onto whatever
 * node now sits at that position would be worse than one that writes none.
 *
 * **What this does not reach, stated rather than implied**: a table that has
 * no spelling of its own inherits the first spelled table in the document
 * through `styleFor`, and the attribute this moves is not on that node. On
 * that table alone a column route still shifts the alignment. Measured: a
 * table created from Insert Table beside a table written `| :--- | :---: |
 * ---: |` is written with that same separator row, and `addColumnBefore` at
 * its first column writes `| :--- | :---: | ---: | --- |`. Recorded on #292
 * as the known hole, with the reason it is not repaired here: materializing
 * the inherited spelling writes an attribute the file never gave that table.
 */
function runColumnRoute(editor: Editor, operation: 'before' | 'after' | 'delete'): void {
  const caret = caretInTable(editor);
  if (!caret) return;
  const command =
    operation === 'before'
      ? 'addColumnBefore'
      : operation === 'after'
        ? 'addColumnAfter'
        : 'deleteColumn';
  const before =
    typeof caret.table.attrs.tableStyle === 'string' ? caret.table.attrs.tableStyle : null;
  const moved = styleWithColumnMoved(before, operation, caret.column);
  editor
    .chain()
    .focus()
    [command]()
    .command(({ tr }) => {
      if (moved === before) return true;
      const table = tr.doc.nodeAt(caret.tablePos);
      if (!table || table.type.name !== 'table') return true;
      tr.setNodeMarkup(caret.tablePos, undefined, { ...table.attrs, tableStyle: moved });
      return true;
    })
    .run();
}

/**
 * The menu mapping, one entry to one command.
 *
 * Each route asks `tableShapeAvailability` first, so a press that reaches a
 * command the entry was greyed for changes nothing — the entries are greyed
 * when the menu opens, and a document can change under an open menu.
 *
 * Every route gives focus back to the document, the way the Insert and Undo
 * entries do: the menu hands focus to its toggle as it closes, and a person
 * who added a row goes on editing where the table now is.
 *
 * It lives here rather than inline in `main.ts` so a test drives the same
 * object the application spreads into `setupMenu`, the shape
 * `history-routes.ts` records — and because a mapping spelled inline was
 * measured on #278 to be swappable with zero tests red.
 */
export function tableShapeMenuCallbacks(editor: Editor): TableShapeMenuCallbacks {
  const rowRoute = (
    name: keyof TableShapeAvailability,
    command: 'addRowBefore' | 'addRowAfter' | 'deleteRow' | 'deleteTable',
  ): (() => void) => {
    return () => {
      if (!tableShapeAvailability(editor)[name]) return;
      editor.chain().focus()[command]().run();
    };
  };
  const columnRoute = (
    name: keyof TableShapeAvailability,
    operation: 'before' | 'after' | 'delete',
  ): (() => void) => {
    return () => {
      if (!tableShapeAvailability(editor)[name]) return;
      runColumnRoute(editor, operation);
    };
  };
  return {
    onAddRowAbove: rowRoute('addRowAbove', 'addRowBefore'),
    onAddRowBelow: rowRoute('addRowBelow', 'addRowAfter'),
    onDeleteRow: rowRoute('deleteRow', 'deleteRow'),
    onAddColumnBefore: columnRoute('addColumnBefore', 'before'),
    onAddColumnAfter: columnRoute('addColumnAfter', 'after'),
    onDeleteColumn: columnRoute('deleteColumn', 'delete'),
    onDeleteTable: rowRoute('deleteTable', 'deleteTable'),
  };
}
