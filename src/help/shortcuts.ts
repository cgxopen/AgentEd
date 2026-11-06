import { chordLabel, modIsCommand } from '../ui/chord-label';

/**
 * The keyboard shortcuts, one list (#701, owner decisions of 2026-11-05).
 *
 * Each row is a row of the Keyboard shortcuts table of `README.md`, which
 * `shortcuts.test.ts` holds equal to it, both columns. The same test holds
 * the list to the keymap: every chord a row names is answered, by the editor
 * keymap or by a listener of ours, and every `Mod` chord the keymap answers
 * is in a row or left out by name with its reason. Help, Keyboard Shortcuts
 * opens the list as a document, in the form of the platform.
 */
export interface Shortcut {
  /** The Windows cell as the README writes it: each chord in a code span. */
  readonly win: string;
  /** The macOS cell, given only where it is not the Windows cell respelled. */
  readonly mac?: string;
  readonly action: string;
  /**
   * Where the chord is answered when it is not the document: the Replace
   * field, whose own listener answers it (`search-panel.ts`).
   */
  readonly field?: 'replace';
}

export const SHORTCUTS: readonly Shortcut[] = [
  { win: '`Ctrl+B` / `Ctrl+I` / `Ctrl+U`', action: 'Bold / Italic / Underline' },
  { win: '`Ctrl+K`', action: 'Insert link, or edit/remove the link at the caret' },
  { win: '`Ctrl` + click', mac: '`Cmd` + click', action: 'Open a link in the system browser' },
  { win: '`Ctrl+E`', action: 'Inline code' },
  { win: '`Ctrl+Shift+K`', action: 'Code block' },
  { win: '`Ctrl+Alt+1` … `Ctrl+Alt+6`', action: 'Heading level 1–6' },
  { win: '`Ctrl+Alt+0`', action: 'Body text' },
  { win: '`Ctrl+Shift+S`', action: 'Strikethrough' },
  { win: '`Ctrl+Shift+B`', action: 'Blockquote' },
  { win: '`Ctrl+Shift+8`', action: 'Bullet list' },
  { win: '`Ctrl+Shift+7`', action: 'Numbered list' },
  { win: '`Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z`', action: 'Undo / Redo' },
  { win: '`Ctrl+A`', action: 'Select all' },
  { win: '`Ctrl+S`', action: 'Save; Save As is in the File menu' },
  { win: '`Ctrl+O`', action: 'Open' },
  { win: '`Ctrl+C` / `Ctrl+X`', action: 'Copy / Cut' },
  {
    win: '`Ctrl+V` / `Ctrl+Shift+V`',
    action: 'Paste, interpreting Markdown / Paste as plain text',
  },
  { win: '`Ctrl+F` / `Ctrl+H`', action: 'Find / Replace' },
  { win: '`Ctrl+Enter` in the Replace field', action: 'Replace All', field: 'replace' },
  { win: '`Ctrl+Alt+F`', action: 'Insert footnote' },
  { win: '`Ctrl+Shift+E`', action: 'Open/close the Files panel' },
  { win: '`F3`', action: 'Find next' },
  { win: '`Shift+F3`', action: 'Find previous' },
  { win: '`Shift+Enter` or `Ctrl+Enter`', action: 'Line break inside a paragraph' },
  { win: '`Tab` / `Shift+Tab`', action: 'Indent/dedent in lists; move between table cells' },
];

/** The macOS cell: given, or each chord of the Windows cell respelled. */
export function macCell(row: Shortcut): string {
  return (
    row.mac ?? row.win.replace(/`([^`]+)`/g, (_, chord: string) => `\`${chordLabel(chord, true)}\``)
  );
}

/** The line under the table on a Mac, which the README writes under it too. */
export const MAC_NOTE = 'On macOS, `Cmd+H` hides AgentEd rather than opening Replace.';

/**
 * The document Help, Keyboard Shortcuts opens: one column of keys, in the
 * form of this platform, by the test the keymap itself reads.
 */
export function shortcutsMarkdown(command: boolean = modIsCommand()): string {
  const lines = ['# Keyboard Shortcuts', '', '| Keys | Action |', '| --- | --- |'];
  for (const row of SHORTCUTS)
    lines.push(`| ${command ? macCell(row) : row.win} | ${row.action} |`);
  if (command) lines.push('', MAC_NOTE);
  return `${lines.join('\n')}\n`;
}
