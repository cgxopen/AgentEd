export interface KeyboardHandlers {
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onLink: () => void;
  /** Make a fenced block at the caret (#204). */
  onCodeBlock: () => void;
  /** Open the files panel, or close it (#347). */
  onToggleSidebar: () => void;
}

/**
 * Global Ctrl/Cmd shortcuts: S (save), O (open), K (link), Shift+K (code
 * block), Shift+E (the files panel).
 *
 * **Shift+S is not one of them, and the list above no longer says it is.** The
 * handler below tests `e.key === 's'`, and with Shift held the key is the
 * uppercase `S`, so that branch has never run: measured on `e4e1f07` by
 * pressing the combination, which gives strikethrough from the editor keymap
 * instead. `onSaveAs` is therefore reachable from the File menu alone. The
 * defect is left where it is and recorded on its own issue rather than
 * repaired inside #347; what is repaired here is the sentence, which claimed a
 * property this code does not have.
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
    // this shape. `e.code` is accepted too, for layouts where the letter is
    // elsewhere. Both of the branches below are spelled that way, and the
    // branch above is the one that is not; the note on this function says what
    // that costs.
    //
    // Ctrl+Shift+E is the files panel (#347), chosen by the owner from the
    // combinations measured free on `e4e1f07`.
    if (e.shiftKey && (e.key === 'e' || e.key === 'E' || e.code === 'KeyE')) {
      e.preventDefault();
      handlers.onToggleSidebar();
      return;
    }
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
