export interface KeyboardHandlers {
  onSave: () => void;
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
 * **Save As has no chord** (owner decision of 2026-09-18). The save branch
 * used to hand a Shift held with it to Save As, testing the lowercase `s`. On
 * Windows that half never ran, since a key held with Shift arrives uppercase;
 * on macOS it ran, since Command+Shift+S arrives as a lowercase `s` with Shift
 * held, measured on a runner on the step zero of #558 - and the editor made the
 * text struck through at the same time, which is what that chord is for. So a
 * save takes no Shift, and Ctrl+Shift+S and Command+Shift+S are left to the
 * editor alone.
 *
 * **The K branch takes no Alt** (#558). It took Alt too, so
 * Ctrl+Alt+K and Command+Option+K opened the link dialog, a chord nobody
 * named; measured on both keys on the same runner. The other branches are
 * left as they were: this repairs the chord the debt names, and changes no
 * other chord on Windows.
 */
export function setupKeyboard(handlers: KeyboardHandlers): void {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    if (e.key === 's' && !e.shiftKey) {
      e.preventDefault();
      handlers.onSave();
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
    if (!e.altKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
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
