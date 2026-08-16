export interface KeyboardHandlers {
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onLink: () => void;
}

/** Global Ctrl/Cmd shortcuts: S (save), Shift+S (save as), O (open), K (link). */
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
      return;
    }
    // Ctrl+K carries no Shift, so `e.key` is the plain letter and the
    // uppercase mismatch that broke Ctrl+Shift+V (#32) cannot arise here.
    // `e.code` is accepted too, for layouts where K is elsewhere.
    if (e.key === 'k' || e.key === 'K' || e.code === 'KeyK') {
      if (e.shiftKey) return; // Ctrl+Shift+K is the code block
      e.preventDefault();
      handlers.onLink();
    }
  });
}
