/**
 * The chords AgentEd names, spelled for the key the person presses (#558).
 *
 * **Which key that is belongs to the editor keymap, not to the platform.**
 * Every chord a label names is bound either as `Mod` in a ProseMirror keymap,
 * or by a listener of ours that asks `isModHeld` below: `app/keyboard.ts`,
 * `app/search-manager.ts`, the replace field of `ui/search-panel.ts`, the
 * plain paste of `editor/paste.ts` and the link click of `app/link-open.ts`.
 * ProseMirror reads `Mod` as Command where `navigator.platform` passes the
 * test below, copied from `prosemirror-keymap` 1.2, and as Ctrl everywhere
 * else. So the label asks the same question the binding does, with the same
 * expression: the desktop build on a Mac and the web build opened on a Mac
 * both say Cmd, because both bind Command. `chord-label.test.ts` holds the two
 * answers together on both kinds of `navigator.platform`.
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

/**
 * Whether the key of a chord is held: Command alone where `Mod` is Command,
 * Ctrl or Command elsewhere, as every listener of ours took it until #627.
 *
 * **On a Mac, Ctrl is left to macOS** (#627). Measured on a macOS runner on
 * the step zero of #627, a listener taking Ctrl or Command took chords the
 * system and its text fields own: Ctrl+F, Ctrl+K, Ctrl+O and Ctrl+H, which
 * move the caret, delete to the end of the line, open a line and delete
 * backward in a field, opened Find, the link dialog, the open panel and
 * Replace instead; Ctrl+Command+F opened Find instead of full screen; and
 * Ctrl+Shift+V, which selects to the page below in a field, selected and
 * pasted nothing. Ctrl and Command held together are not the chord either,
 * since the system chords that hold both are not ours.
 */
export function isModHeld(
  event: { readonly ctrlKey: boolean; readonly metaKey: boolean },
  command: boolean = COMMAND,
): boolean {
  if (command) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey || event.metaKey;
}

/**
 * The chords that are other keys on a Mac, not the same keys under Command
 * (#630, owner decision of 2026-10-19): Replace takes Option+Cmd+F, the Find
 * and Replace of TextEdit, Script Editor and Xcode, measured on a macOS
 * runner, and leaves Cmd+H to Hide; the footnote, which held Option+Cmd+F,
 * takes Option+Cmd+N. Each is written here in both spellings, the label and
 * the `aria-keyshortcuts` value, so a label and the binding of the chord
 * (`app/search-manager.ts`, `editor/insert-footnote.ts`) say the same.
 */
export const MAC_CHORDS = [
  { label: ['Ctrl+H', 'Cmd+Option+F'], aria: ['Control+H', 'Meta+Alt+F'] },
  { label: ['Ctrl+Alt+F', 'Cmd+Option+N'], aria: ['Control+Alt+F', 'Meta+Alt+N'] },
] as const;

/** `text` with each whole chord of `pairs` spelled the second way. */
function respellWhole(text: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs.reduce((out, [from, to]) => {
    const escaped = from.replace(/[+]/g, '\\+');
    return out.replace(new RegExp(`(^|[^\\w+])${escaped}(?![\\w+])`, 'g'), `$1${to}`);
  }, text);
}

/** A label as the person reads it: `Ctrl+Z` on Windows, `Cmd+Z` on a Mac. */
export function chordLabel(windowsSpelling: string, command: boolean = COMMAND): string {
  if (!command) return windowsSpelling;
  return respellWhole(
    windowsSpelling,
    MAC_CHORDS.map((chord) => chord.label),
  )
    .replace(/\bCtrl\+/g, 'Cmd+')
    .replace(/\bAlt\+/g, 'Option+')
    .replace(/(^|[\s(,])((?:Shift\+)?F\d{1,2})\b/g, '$1Fn+$2');
}

/** An `aria-keyshortcuts` value: `Control+Z`, or `Meta+Z` on a Mac. */
export function chordAria(windowsValue: string, command: boolean = COMMAND): string {
  if (!command) return windowsValue;
  return respellWhole(
    windowsValue,
    MAC_CHORDS.map((chord) => chord.aria),
  ).replace(/\bControl\+/g, 'Meta+');
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
