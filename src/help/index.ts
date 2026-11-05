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
  return id === 'shortcuts' ? shortcutsMarkdown() : guide;
}
