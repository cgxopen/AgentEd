import type { Editor } from '@tiptap/core';
import { insertTableFromMenu } from '../editor/insert-table';

/**
 * The largest table the dialog makes, matching the `max` on its two fields in
 * `index.html`. A browser does not enforce `max` on a typed value, and the
 * table is built by a loop over both numbers, so the bound is applied here.
 */
const MAX_ROWS = 50;
const MAX_COLS = 20;

/** A field's number, at least one and at most `max`, or the default of three. */
function sizeFrom(input: HTMLInputElement, max: number): number {
  return Math.min(max, Math.max(1, parseInt(input.value, 10) || 3));
}

/**
 * Setup the insert-table dialog. Returns `open()` to show it pre-filled
 * with defaults (3x3 with header row). Enter confirms, Escape cancels.
 */
export function setupTableDialog(editor: Editor): { open: () => void } {
  const dialog = document.getElementById('table-dialog')!;
  const rowsInput = document.getElementById('table-rows') as HTMLInputElement;
  const colsInput = document.getElementById('table-cols') as HTMLInputElement;

  function close(): void {
    dialog.classList.add('hidden');
  }

  function confirm(): void {
    const rows = sizeFrom(rowsInput, MAX_ROWS);
    const cols = sizeFrom(colsInput, MAX_COLS);
    close();
    insertTableFromMenu(editor, { rows, cols });
  }

  document.getElementById('table-confirm')!.addEventListener('click', confirm);
  document.getElementById('table-cancel')!.addEventListener('click', close);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  function open(): void {
    rowsInput.value = '3';
    colsInput.value = '3';
    dialog.classList.remove('hidden');
    rowsInput.focus();
    rowsInput.select();
  }

  return { open };
}

/**
 * The Insert Table entry, as the mapping from entry to command (#278).
 *
 * It exists because of a measurement. With `main.ts` spelling
 * `onInsertTable: tableDialog.open` inline, swapping it with the code-block
 * entry turned **zero of 2841** tests red and `tsc` agreed with the swap; and
 * with `insertTable` replaced by another command in this file, zero again —
 * nothing imported this file at all. The #204 shape, at both addresses.
 *
 * Now `main.ts` spreads this object and the tests spread the same one, driving
 * the real rendered entry through the real dialog into `insertTableFromMenu`.
 * The key is declared here rather than imported from `MenuCallbacks`, as
 * `insertMenuCallbacks` does, and the compiler joins the two where they meet:
 * `MenuCallbacks` requires the key, so a `main.ts` that stopped spreading this
 * would not compile.
 */
export function tableMenuCallbacks(editor: Editor): { readonly onInsertTable: () => void } {
  return { onInsertTable: setupTableDialog(editor).open };
}
