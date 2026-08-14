export type DialogVariant = 'default' | 'primary' | 'danger';

export interface DialogAction<T extends string = string> {
  label: string;
  value: T;
  variant?: DialogVariant;
}

export interface ConfirmDialogOptions<T extends string = string> {
  title: string;
  message: string;
  actions: DialogAction<T>[];
  defaultAction?: T;
  dismissible?: boolean;
}

let activeDialog: HTMLElement | null = null;

/**
 * Modal dialog with custom buttons. Resolves with the pressed button's `value`,
 * or `null` if dismissed via Escape / outside click (when dismissible).
 */
export async function showConfirmDialog<T extends string>(
  options: ConfirmDialogOptions<T>,
): Promise<T | null> {
  if (options.actions.length < 1 || options.actions.length > 4) {
    throw new Error(`showConfirmDialog: actions must be 1-4 (got ${options.actions.length})`);
  }
  if (activeDialog) {
    console.warn('showConfirmDialog: another dialog is already open; rejecting new request');
    return null;
  }

  const dismissible = options.dismissible !== false;
  const previouslyFocused = document.activeElement as HTMLElement | null;

  return new Promise<T | null>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'dialog';

    const titleEl = document.createElement('div');
    titleEl.className = 'dialog-title';
    titleEl.id = `dialog-title-${Date.now()}`;
    titleEl.textContent = options.title;
    overlay.setAttribute('aria-labelledby', titleEl.id);

    const messageEl = document.createElement('div');
    messageEl.className = 'dialog-message';
    messageEl.id = `dialog-msg-${Date.now()}`;
    messageEl.textContent = options.message;
    overlay.setAttribute('aria-describedby', messageEl.id);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'dialog-actions';

    const buttons: HTMLButtonElement[] = [];
    let defaultButton: HTMLButtonElement | null = null;

    for (const action of options.actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      if (action.variant === 'primary') btn.classList.add('primary');
      if (action.variant === 'danger') btn.classList.add('danger');
      btn.addEventListener('click', () => finish(action.value));
      actionsEl.appendChild(btn);
      buttons.push(btn);
      if (options.defaultAction !== undefined && action.value === options.defaultAction) {
        defaultButton = btn;
      }
    }

    dialog.appendChild(titleEl);
    dialog.appendChild(messageEl);
    dialog.appendChild(actionsEl);
    overlay.appendChild(dialog);

    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (dismissible) {
          e.preventDefault();
          finish(null);
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (defaultButton) defaultButton.click();
        else if (buttons.length > 0) buttons[0].click();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const dir = e.shiftKey ? -1 : 1;
        const next = idx === -1 ? 0 : (idx + dir + buttons.length) % buttons.length;
        buttons[next].focus();
      }
    }

    function onOverlayClick(e: MouseEvent): void {
      if (!dismissible) return;
      if (e.target === overlay) finish(null);
    }

    function finish(value: T | null): void {
      if (activeDialog !== overlay) return;
      document.removeEventListener('keydown', onKeydown, true);
      overlay.removeEventListener('click', onOverlayClick);
      overlay.remove();
      activeDialog = null;
      previouslyFocused?.focus?.();
      resolve(value);
    }

    document.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('click', onOverlayClick);

    document.body.appendChild(overlay);
    activeDialog = overlay;
    (defaultButton ?? buttons[0]).focus();
  });
}
