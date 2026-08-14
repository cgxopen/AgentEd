import type { Editor } from '@tiptap/core';

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
    const rows = Math.max(1, parseInt(rowsInput.value, 10) || 3);
    const cols = Math.max(1, parseInt(colsInput.value, 10) || 3);
    close();
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
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
