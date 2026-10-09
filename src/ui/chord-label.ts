/**
 * The chords AgentEd names, spelled for the key the person presses (#558).
 *
 * **Which key that is belongs to the editor keymap, not to the platform.**
 * Every chord a label names is bound either as `Mod` in a ProseMirror keymap,
 * or in `app/keyboard.ts` and `app/search-manager.ts`, which take Ctrl or
 * Command alike. ProseMirror reads `Mod` as Command where `navigator.platform`
 * passes the test below, copied from `prosemirror-keymap` 1.2, and as Ctrl
 * everywhere else. So the label asks the same question the binding does, with
 * the same expression: the desktop build on a Mac and the web build opened on
 * a Mac both say Cmd, because both bind Command. `chord-label.test.ts` holds
 * the two answers together on both kinds of `navigator.platform`.
 *
 * Measured on a macOS runner on the step zero of #558: with Command every chord
 * of the menu and the README works; with Ctrl, Undo, Redo, the marks and the
 * headings do nothing or type a character instead.
 *
 * **The source spelling is the Windows one**, which `index.html` and the code
 * write and which is shown unchanged where Ctrl is the key: every `Ctrl` in it
 * means the keymap's `Mod`. On a Mac it becomes Cmd, Alt becomes Option, and a
 * function key takes Fn, which a Mac keyboard needs to send one (owner decision
 * on #558: F3 stays the chord, and the label says Fn).
 */

/** `prosemirror-keymap`: `/Mac|iP(hone|[oa]d)/.test(navigator.platform)`. */
export function modIsCommand(
  platform: string | undefined = globalThis.navigator?.platform,
): boolean {
  return platform !== undefined && /Mac|iP(hone|[oa]d)/.test(platform);
}

const COMMAND = modIsCommand();

/** A label as the person reads it: `Ctrl+Z` on Windows, `Cmd+Z` on a Mac. */
export function chordLabel(windowsSpelling: string, command: boolean = COMMAND): string {
  if (!command) return windowsSpelling;
  return windowsSpelling
    .replace(/\bCtrl\+/g, 'Cmd+')
    .replace(/\bAlt\+/g, 'Option+')
    .replace(/(^|[\s(,])((?:Shift\+)?F\d{1,2})\b/g, '$1Fn+$2');
}

/** An `aria-keyshortcuts` value: `Control+Z`, or `Meta+Z` on a Mac. */
export function chordAria(windowsValue: string, command: boolean = COMMAND): string {
  if (!command) return windowsValue;
  return windowsValue.replace(/\bControl\+/g, 'Meta+');
}

/**
 * Respell every chord the shipped markup names, under `root`. Does nothing
 * where the keymap binds Ctrl, so the page reads as it is written.
 */
export function applyChordLabels(root: ParentNode, command: boolean = COMMAND): void {
  if (!command) return;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[aria-keyshortcuts]'))) {
    el.setAttribute(
      'aria-keyshortcuts',
      chordAria(el.getAttribute('aria-keyshortcuts') ?? '', true),
    );
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[title]'))) {
    el.title = chordLabel(el.title, true);
  }
}
