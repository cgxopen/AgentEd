import {
  clearDiagnostics,
  diagnosticLines,
  formatDiagnostics,
  markDiagnosticRoute,
} from '../editor/paste-diagnostics';
import { copyText } from './clipboard';
import { showConfirmDialog } from './confirm-dialog';
import { showToast } from './toast';

/**
 * Paste diagnostics — **diagnostic build only, never merged.**
 *
 * A release build has no devtools, so the log needs a way out of the app. This
 * shows the tail of it and copies the whole buffer on one click, which is all
 * the tester has to do: run the four routes, open this, press Copy, paste the
 * result into the PR.
 */

/** Lines shown in the dialog. The rest is still copied — this is only so the
 *  dialog cannot grow past the buttons at the bottom of the screen. */
const VISIBLE_LINES = 14;

export async function showPasteDiagnostics(): Promise<void> {
  const lines = diagnosticLines();
  const shown = lines.slice(-VISIBLE_LINES);
  const hidden = lines.length - shown.length;

  const header =
    lines.length === 0
      ? 'Nothing recorded yet. Paste something, then open this again.'
      : `${lines.length} events recorded${hidden > 0 ? ` — showing the last ${shown.length}` : ''}.\nCopy sends all of them to the clipboard.`;

  const choice = await showConfirmDialog({
    title: 'Paste diagnostics',
    message: `${header}\n\n${shown.join('\n')}`,
    actions: [
      { label: 'Copy', value: 'copy', variant: 'primary' },
      { label: 'Mark route', value: 'mark' },
      { label: 'Clear', value: 'clear', variant: 'danger' },
      { label: 'Close', value: 'close' },
    ],
    defaultAction: 'close',
  });

  if (choice === 'copy') {
    const copied = await copyText(formatDiagnostics());
    showToast(
      copied ? `Copied ${lines.length} diagnostic events.` : 'Could not copy the diagnostics.',
      copied ? 'info' : 'warn',
    );
    return;
  }

  if (choice === 'mark') {
    // A separator between routes, so one log covers all four runs and still
    // reads as four runs.
    markDiagnosticRoute(`route ${countRoutes(lines) + 1}`);
    showToast('Marked. Run the next paste route now.');
    return;
  }

  if (choice === 'clear') {
    clearDiagnostics();
    showToast('Diagnostics cleared.');
  }
}

function countRoutes(lines: readonly string[]): number {
  return lines.filter((line) => line.includes('---route---')).length;
}
