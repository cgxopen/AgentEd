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
  dialog(message: string, error: unknown, title?: string): Promise<void>;
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
    async dialog(message, error, title = 'Error') {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(title, error);
      await showConfirmDialog({
        title,
        message: `${message}\n\n${detail}`,
        actions: [{ label: 'OK', value: 'ok', variant: 'primary' }],
      });
    },
  };
}
