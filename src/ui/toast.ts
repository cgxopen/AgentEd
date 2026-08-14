export type ToastKind = 'info' | 'warn' | 'error';

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);
  return container;
}

/** Show a transient toast message in the top-right corner (auto-hides after 3s). */
export function showToast(message: string, kind: ToastKind = 'info'): void {
  const c = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  c.appendChild(toast);

  // Trigger CSS transition
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}
