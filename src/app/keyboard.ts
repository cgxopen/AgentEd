export interface KeyboardHandlers {
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
}

/** Global Ctrl/Cmd shortcuts: S (save), Shift+S (save as), O (open). */
export function setupKeyboard(handlers: KeyboardHandlers): void {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    if (e.key === 's') {
      e.preventDefault();
      if (e.shiftKey) handlers.onSaveAs();
      else handlers.onSave();
      return;
    }
    if (e.key === 'o') {
      e.preventDefault();
      handlers.onOpen();
    }
  });
}
