import { getProfile } from '../profiles/index';
import { setInsertMediaEnabled } from '../ui/menu';
import { updateValidationIndicator } from '../ui/validation-panel';
import { runValidation } from '../validation/index';
import type { AppContext } from './context';

const VALIDATION_DEBOUNCE_MS = 500;

/**
 * Drives validation + insert-media availability off the active profile.
 *
 * Two public entry points:
 *   - triggerValidation(): re-run the validator now and refresh the
 *     panel + indicator + Insert Media toggle.
 *   - triggerValidationDebounced(): same, debounced for keystroke flows.
 *
 * Insert Media availability is a side effect of validation triggering —
 * profile changes always go through one of the two entry points, so the
 * Insert Media menu item stays in sync without a separate update path.
 */
export class ProfileManager {
  private validationTimer: ReturnType<typeof setTimeout> | null = null;
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  triggerValidation(): void {
    const profile = getProfile(this.ctx.state.profile);
    this.updateInsertMediaEnabled(profile.allowsImagePaste);

    if (profile.activeRuleIds.size === 0) {
      updateValidationIndicator(null);
      this.ctx.validationPanel.clear();
      return;
    }

    const md = this.getFullMarkdown();
    const result = runValidation(md, { profile });
    this.ctx.validationPanel.update(result);
    updateValidationIndicator(result);
  }

  triggerValidationDebounced(): void {
    if (this.validationTimer) clearTimeout(this.validationTimer);
    this.validationTimer = setTimeout(() => this.triggerValidation(), VALIDATION_DEBOUNCE_MS);
  }

  private getFullMarkdown(): string {
    const body = this.ctx.getMarkdown();
    if (!this.ctx.state.frontmatter) return body;
    return `---\n${this.ctx.state.frontmatter}\n---\n${body}`;
  }

  private updateInsertMediaEnabled(allowed: boolean): void {
    setInsertMediaEnabled(allowed);
  }
}
