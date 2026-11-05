import { chordLabel, modIsCommand } from '../ui/chord-label';
import guide from './guide.md?raw';
import type { HelpId } from './ids';
import { shortcutsMarkdown } from './shortcuts';

export type { HelpId } from './ids';

/**
 * The name a help is shown under: the header, the unsaved-changes question
 * and the window title. `src-tauri/src/help_window.rs` writes the same two
 * names for the window title on Windows and Linux, where the page sets none.
 */
export const HELP_TITLES: Readonly<Record<HelpId, string>> = {
  shortcuts: 'Keyboard Shortcuts',
  guide: 'User Guide',
};

/** The text a help opens with, bundled in the page: no file is read. */
export function helpMarkdown(id: HelpId): string {
  return id === 'shortcuts' ? shortcutsMarkdown() : guideMarkdown();
}

/**
 * A bold span of the guide that names a chord: keys joined by `+`, the last a
 * letter, a digit, a function key, Enter or Tab; or `Ctrl` alone, the key held
 * for the click that follows a link. A menu path such as **File, Open** is not
 * one.
 */
const GUIDE_CHORD = /^(?:(?:Ctrl|Shift|Alt)\+)*(?:[A-Z0-9]|F\d{1,2}|Enter|Tab)$|^Ctrl$/;

/**
 * A code span, kept whole, or a bold span and its text. Code spans are matched
 * first so the `**` the guide shows in one, as the mark of bold, does not pair
 * with the bold around a chord.
 */
const BOLD_OR_CODE = /`[^`]*`|\*\*([^*]+)\*\*/g;

/** Every chord the guide names, as written: the Windows form (#701, decision 4). */
export function guideChords(text: string = guide): string[] {
  return [...text.matchAll(BOLD_OR_CODE)]
    .map((match) => match[1])
    .filter((inner): inner is string => inner !== undefined && GUIDE_CHORD.test(inner));
}

/**
 * The guide in the form of this platform (#701, owner decision 4): each chord
 * it names is respelled by `chordLabel`, as the tooltips and the shortcuts
 * table are, and the `Ctrl` of a link click becomes `Cmd`. `guide.md` keeps the
 * text the owner approved, in the Windows form; only what the help opens
 * changes.
 */
export function guideMarkdown(command: boolean = modIsCommand(), text: string = guide): string {
  if (!command) return text;
  return text.replace(BOLD_OR_CODE, (whole, inner: string | undefined) => {
    if (inner === undefined || !GUIDE_CHORD.test(inner)) return whole;
    return `**${inner === 'Ctrl' ? 'Cmd' : chordLabel(inner, true)}**`;
  });
}
