export interface KeyboardHandlers {
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onLink: () => void;
  /** Make a fenced block at the caret (#204). */
  onCodeBlock: () => void;
}

/**
 * Global Ctrl/Cmd shortcuts: S (save), Shift+S (save as), O (open), K (link),
 * Shift+K (code block).
 */
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
    // `e.key` is the uppercase letter when Shift is held, so both spellings are
    // matched — the uppercase mismatch that broke Ctrl+Shift+V (#32) is exactly
    // this shape. `e.code` is accepted too, for layouts where K is elsewhere.
    if (e.key === 'k' || e.key === 'K' || e.code === 'KeyK') {
      e.preventDefault();
      // Ctrl+Shift+K is the code block. This used to `return` here instead,
      // with that sentence written beside it as the reason — and nothing bound
      // the combination, so the one handler that saw it declined and it fell
      // through to nowhere while the README told readers it worked (#204).
      if (e.shiftKey) handlers.onCodeBlock();
      else handlers.onLink();
    }
  });
}
