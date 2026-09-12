import type { Editor } from '@tiptap/core';
import type { NodeType, Node as ProseMirrorNode, ResolvedPos, Schema } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

/** The size the dialog asked for. */
export interface TableSize {
  readonly rows: number;
  readonly cols: number;
}

/**
 * The command behind Insert Table, at one address (#278).
 *
 * **Outside a table** it inserts a table at the caret, as it always did — the
 * case the entry is named for.
 *
 * **Inside a table it inserts the new table after the one the caret is in**,
 * owner decision of 2026-09-11. Until #278 it put the new table inside the cell,
 * and a table inside a cell is the one table GFM has no spelling for: the
 * serializer tore it apart on the first save, eleven columns where there had
 * been two. Refusing was the silent press turned down on #275, and adding a row
 * would have left the dialog asking for rows by columns when neither means
 * anything for one row.
 *
 * "The one the caret is in" is read as the **outermost** table. A table inside
 * a cell reaches the document only from a file now, and pressing the entry in
 * one of its cells puts the new table after the whole outer table rather than
 * beside the inner one, so the entry itself never builds that shape.
 *
 * **A table inside a checklist item is the one exception, and it is measured
 * rather than chosen for tidiness.** An item's own blocks are written one
 * newline apart, so a second table placed beside the first inside the item is
 * written with no blank line between them and read back as more rows of the
 * first — the file stops meaning what the screen shows. That is older than this
 * change and reported on #278 as its own candidate; until it is repaired, the
 * new table goes after the **whole checklist**, which was measured to save and
 * read back unchanged. Owner decision of 2026-09-11.
 *
 * Both branches are decided on **one** read of the selection, inside the
 * command and after `focus` has run — so there is no second read for the first
 * to disagree with, which is the shape the #277 review asked about.
 */
export function insertTableFromMenu(editor: Editor, { rows, cols }: TableSize): void {
  editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch, commands }) => {
      const depth = insertionDepth(tr.selection.$to);
      if (depth === null) return commands.insertTable({ rows, cols, withHeaderRow: true });
      const table = emptyTable(state.schema, rows, cols);
      if (!table) return false;
      if (dispatch) {
        const after = tr.selection.$to.after(depth);
        tr.insert(after, table);
        // Into the new table's first cell, the way `insertTable` leaves it.
        tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
        tr.scrollIntoView();
      }
      return true;
    })
    .run();
}

/**
 * Where the new table goes: the depth of the node it is placed after, or `null`
 * when the caret is in no table at all and the table belongs at the caret.
 *
 * The outermost table, unless a checklist encloses that table, in which case the
 * checklist — see the note above on what a second table inside an item does to
 * the file. A checklist *inside* a cell does not count, because the walk stops
 * at the first table it meets from the outside. Bounded by the depth of the
 * position.
 */
function insertionDepth($pos: ResolvedPos): number | null {
  let table: number | null = null;
  let checklist: number | null = null;
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    const name = $pos.node(depth).type.name;
    if (name === 'taskList' && checklist === null) checklist = depth;
    if (name === 'table') {
      table = depth;
      break;
    }
  }
  if (table === null) return null;
  return checklist !== null && checklist < table ? checklist : table;
}

/**
 * An empty table with a header row, the shape `insertTable` makes. `rows` and
 * `cols` come from the dialog, which bounds them.
 */
function emptyTable(schema: Schema, rows: number, cols: number): ProseMirrorNode | null {
  const { table, tableRow, tableHeader, tableCell } = schema.nodes;
  const row = (cellType: NodeType): ProseMirrorNode | null => {
    const cells: ProseMirrorNode[] = [];
    for (let c = 0; c < cols; c += 1) {
      const cell = cellType.createAndFill();
      if (!cell) return null;
      cells.push(cell);
    }
    return tableRow.createAndFill(null, cells);
  };
  const lines: ProseMirrorNode[] = [];
  for (let r = 0; r < rows; r += 1) {
    const line = row(r === 0 ? tableHeader : tableCell);
    if (!line) return null;
    lines.push(line);
  }
  return table.createAndFill(null, lines);
}
