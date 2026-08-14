import { basename } from '../platform/paths';
import { showConfirmDialog } from '../ui/confirm-dialog';
import type { AppContext } from './context';

export type DiscardAction = 'new' | 'open' | 'close';

/**
 * Build the gate that protects destructive actions (New / Open / Close)
 * from losing unsaved work. The returned function returns:
 *   - `true`  if the caller may proceed (nothing modified, or user picked
 *             Save and save succeeded, or user picked Discard)
 *   - `false` if the caller must abort (Cancel, or Save failed)
 *
 * The gate needs a reference to `handleSave` because one of the
 * dialog choices invokes it. Pass it in at construction time; it's a
 * stable reference by the time any handler calls the gate.
 */
export function createDiscardGate(
  ctx: AppContext,
  handleSave: () => Promise<void>,
): (action: DiscardAction) => Promise<boolean> {
  return async function discardCurrentDocument(action: DiscardAction): Promise<boolean> {
    if (!ctx.state.modified) return true;

    const filename = ctx.state.filePath ? basename(ctx.state.filePath) : 'untitled document';
    const actionLabel = {
      new: 'creating a new document',
      open: 'opening another document',
      close: 'closing',
    }[action];

    const choice = await showConfirmDialog<'save' | 'discard' | 'cancel'>({
      title: 'Unsaved changes',
      message: `${filename} has unsaved changes.\nWhat do you want to do before ${actionLabel}?`,
      actions: [
        { label: 'Save', value: 'save', variant: 'primary' },
        { label: 'Discard', value: 'discard', variant: 'danger' },
        { label: 'Cancel', value: 'cancel' },
      ],
      defaultAction: 'save',
    });

    if (choice === null || choice === 'cancel') return false;

    if (choice === 'save') {
      try {
        await handleSave();
      } catch (e) {
        await ctx.reporter.dialog(
          `Could not save ${filename}.\n\nAction cancelled.`,
          e,
          'Save failed',
        );
        return false;
      }
      return !ctx.state.modified;
    }

    return true;
  };
}
