import { showConfirmDialog } from '../ui/confirm-dialog';
import { showToast } from '../ui/toast';

/**
 * Three-level error surfacing, so call-sites pick intent explicitly:
 *   - silent: log to console only (background side-effects where
 *     surfacing to user would be noise)
 *   - toast: short transient banner (retryable / advisory failures)
 *   - dialog: modal OK dialog (blocking failures that stop the action)
 *
 * All three write a console message for grepability when debugging. The
 * intent label (silent/toast/dialog) was chosen at the call site, so we
 * don't try to promote a silent failure to a toast or vice versa here.
 */
export interface ErrorReporter {
  silent(context: string, error: unknown): void;
  toast(message: string, error: unknown, variant?: 'info' | 'warn' | 'error'): void;
  /**
   * A modal the user has to dismiss, for a failure that stopped what
   * they asked for.
   *
   * **`detail` decides whether the error's own text is shown beneath
   * `message`.** It defaults to `'append'`, which is right at every call
   * site that has no sentence of its own: there, the error's text is all
   * the user gets and dropping it would leave a dialog that says nothing.
   *
   * `'omit'` is for the opposite case — a call site whose wording layer
   * has already written the whole of what the user should read. Appending
   * a mechanism under a finished paragraph undoes the decisions that went
   * into it: `Could not resolve a file handle for: notes/AGENTS.md` is a
   * File System Access term the reader has no use for, under a sentence
   * that already named the path (#127).
   *
   * Either way the error reaches the console unchanged. What `'omit'`
   * drops is a line on screen, never a line in the log.
   */
  dialog(
    message: string,
    error: unknown,
    title?: string,
    detail?: 'append' | 'omit',
  ): Promise<void>;
}

export function createErrorReporter(): ErrorReporter {
  return {
    silent(context, error) {
      console.warn(`${context}:`, error);
    },
    toast(message, error, variant = 'error') {
      console.warn(`${message}:`, error);
      showToast(message, variant);
    },
    async dialog(message, error, title = 'Error', detail = 'append') {
      console.error(title, error);
      const shown =
        detail === 'omit'
          ? message
          : `${message}\n\n${error instanceof Error ? error.message : String(error)}`;
      await showConfirmDialog({
        title,
        message: shown,
        actions: [{ label: 'OK', value: 'ok', variant: 'primary' }],
      });
    },
  };
}
