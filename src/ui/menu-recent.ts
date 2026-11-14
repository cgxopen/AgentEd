/**
 * Open Recent: one entry of the File section that opens the recent files list
 * as a card beside the menu (#381, owner decision of 2026-09-19, over ten
 * entries inside the section, which took the File section from 192 px to 544
 * and pushed Save below the fold at the 600 by 400 minimum).
 *
 * The list is read when it is shown, never held, because another window may
 * have opened a file since. Each entry shows the file name and, on its right,
 * enough of the folder to tell it from the others; the whole path is on hover.
 *
 * The card stands beside the menu, and the keyboard enters and leaves it
 * sideways; how it is placed, entered and left is `menu-side-card.ts`, which it
 * shares with the Metadata card since #715.
 */
import { basename, dirname, normalize } from '../platform/paths';
import { installSideCard, type SideCard } from './menu-side-card';

export interface RecentMenuOptions {
  readonly trigger: HTMLButtonElement;
  readonly dropdown: HTMLElement;
  /** The list, newest first, read as it is shown. */
  readonly read: () => readonly string[];
  readonly onOpen: (path: string) => void;
  readonly onClear: () => void;
  /** Close the whole menu, before a command runs. */
  readonly closeMenu: () => void;
}

export type RecentMenu = SideCard;

/** The id of the card, which the entry names in `aria-controls`. */
export const RECENT_MENU_ID = 'menu-recent';

export interface RecentLabel {
  readonly name: string;
  readonly folder: string;
}

const windowsShaped = (path: string) => /^[A-Za-z]:\//.test(path) || path.startsWith('//');

/**
 * The name of each file, and the fewest folders above it that tell it from
 * every other entry of the same name: one, and one more for as long as two
 * would read the same. Bounded by the depth of the path itself. Written with
 * the separator the path's own system uses.
 */
export function recentLabels(paths: readonly string[]): RecentLabel[] {
  const parts = paths.map((path) => {
    const slashed = normalize(path);
    return {
      name: basename(slashed),
      folders: dirname(slashed).split('/').filter(Boolean),
      separator: windowsShaped(slashed) ? '\\' : '/',
    };
  });
  const tail = (folders: readonly string[], depth: number) => folders.slice(-depth).join('/');
  return parts.map((part, i) => {
    let depth = 1;
    const clashes = () =>
      parts.some(
        (other, j) =>
          j !== i &&
          other.name.toLowerCase() === part.name.toLowerCase() &&
          tail(other.folders, depth).toLowerCase() === tail(part.folders, depth).toLowerCase(),
      );
    while (depth < part.folders.length && clashes()) depth += 1;
    return { name: part.name, folder: part.folders.slice(-depth).join(part.separator) };
  });
}

function entry(label: string, folder: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  const name = document.createElement('span');
  name.className = 'menu-recent-name';
  name.textContent = label;
  button.appendChild(name);
  if (folder.length > 0) {
    const where = document.createElement('span');
    where.className = 'menu-shortcut menu-recent-folder';
    where.textContent = folder;
    button.appendChild(where);
  }
  if (title.length > 0) button.title = title;
  return button;
}

export function installRecentMenu(options: RecentMenuOptions): RecentMenu {
  function rows(): HTMLButtonElement[] {
    const paths = options.read();
    if (paths.length === 0) return [];
    const labels = recentLabels(paths);
    const buttons = paths.map((path, i) => {
      const button = entry(labels[i].name, labels[i].folder, path);
      button.addEventListener('click', () => {
        options.closeMenu();
        options.onOpen(path);
      });
      return button;
    });
    const clear = entry('Clear recent files', '', '');
    clear.id = 'menu-recent-clear';
    clear.addEventListener('click', () => {
      options.closeMenu();
      options.onClear();
    });
    return [...buttons, clear];
  }

  return installSideCard({
    trigger: options.trigger,
    dropdown: options.dropdown,
    id: RECENT_MENU_ID,
    label: 'Recent files',
    className: 'menu-recent',
    rows,
  });
}
