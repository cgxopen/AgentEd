import type { ExternalChange } from '../formats/index';
import { showConfirmDialog } from '../ui/confirm-dialog';

/**
 * What the user decided to do about a file that changed underneath
 * them. `cancel` is the Cancel button (#737) and is also what dismissing
 * the dialog means, with Escape or a click outside it: one answer for
 * both, so stepping back has one meaning however it is done. Nothing is
 * written, and the document stays modified, which is the accurate
 * statement (R-C3).
 */
export type ExternalChangeChoice = 'reload' | 'overwrite' | 'save-as' | 'cancel';

/**
 * Ask about a file that no longer matches what AgentEd last put there
 * (R-C14). The comparison is a fact and lives in `src/formats`; which
 * buttons appear and what they say is a product decision and lives here.
 *
 * The message spells out what each choice costs, because this dialog
 * *is* the informed decision: **Reload** discards the edits in the
 * editor, and it does not route through the unsaved-changes gate a
 * second time. The gate's own Save button would lead straight back into
 * the conflict that raised this dialog — a loop — and its Discard button
 * asks the same question this one already asked, in vaguer words. One
 * dialog that names what is lost beats two that pass the question
 * between them (R-C14, amended in the PR that added this).
 *
 * `Save as…` is the default: it is the only choice that keeps both
 * versions, so it is the safe thing to arrive at by pressing Enter.
 * `showConfirmDialog` sends Enter to the default button wherever the
 * focus is, so Cancel is never reached by Enter. Cancel stands first, at
 * the left, as in the other dialogs where the primary button is the
 * last; the three choices keep their order and Save as stays at the
 * right. The message names the three choices and not Cancel, which
 * costs nothing and says so by its word.
 */
export async function askAboutExternalChange(
  filename: string,
  change: ExternalChange,
): Promise<ExternalChangeChoice> {
  const opening =
    change.kind === 'unverifiable'
      ? `AgentEd could not read ${filename} to check whether it changed since it was opened.`
      : `${filename} has changed on disk since it was opened here.`;

  const choice = await showConfirmDialog<ExternalChangeChoice>({
    title: change.kind === 'unverifiable' ? 'Could not check the file' : 'File changed on disk',
    message:
      `${opening}\n\n` +
      'Reload — open the version on disk and lose the changes made here.\n' +
      'Overwrite — replace the version on disk with this one.\n' +
      'Save as… — keep both, and save this one elsewhere.',
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Reload', value: 'reload', variant: 'danger' },
      { label: 'Overwrite', value: 'overwrite', variant: 'danger' },
      { label: 'Save as…', value: 'save-as', variant: 'primary' },
    ],
    defaultAction: 'save-as',
  });

  return choice ?? 'cancel';
}
