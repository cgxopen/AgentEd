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
 * It is the one card of the menu that stands beside it, so it is also the one
 * the keyboard enters and leaves sideways: the arrow right, or Enter, from Open
 * Recent goes in; the arrow left, or Escape, comes back to it.
 */
import { basename, dirname, normalize } from '../platform/paths';

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

export interface RecentMenu {
  /** Hide the card, if it is shown. */
  hide(): void;
}

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
  const { trigger, dropdown } = options;
  let card: HTMLElement | null = null;

  function hide(): void {
    card?.remove();
    card = null;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function build(paths: readonly string[]): HTMLElement {
    const group = document.createElement('div');
    group.id = RECENT_MENU_ID;
    group.className = 'menu-recent';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Recent files');
    const labels = recentLabels(paths);
    paths.forEach((path, i) => {
      const button = entry(labels[i].name, labels[i].folder, path);
      button.addEventListener('click', () => {
        options.closeMenu();
        options.onOpen(path);
      });
      group.appendChild(button);
    });
    const clear = entry('Clear recent files', '', '');
    clear.id = 'menu-recent-clear';
    clear.addEventListener('click', () => {
      options.closeMenu();
      options.onClear();
    });
    group.appendChild(clear);
    group.addEventListener('keydown', onCardKey);
    return group;
  }

  /** Beside the menu, level with the entry, and never past the window or over the header. */
  function place(group: HTMLElement): void {
    const menu = dropdown.getBoundingClientRect();
    const at = trigger.getBoundingClientRect();
    const floor = dropdown.offsetParent?.getBoundingClientRect().bottom ?? menu.top;
    group.style.left = `${menu.right + 4}px`;
    group.style.maxHeight = `${window.innerHeight - floor - 8}px`;
    const height = group.getBoundingClientRect().height;
    group.style.top = `${Math.max(floor, Math.min(at.top - 5, window.innerHeight - height - 8))}px`;
  }

  function show(focusFirst: boolean): void {
    if (card === null) {
      const paths = options.read();
      if (paths.length === 0) return;
      card = build(paths);
      dropdown.appendChild(card);
      place(card);
      trigger.setAttribute('aria-expanded', 'true');
    }
    if (focusFirst) card.querySelector<HTMLElement>('button')?.focus();
  }

  function onCardKey(e: KeyboardEvent): void {
    if (card === null) return;
    const buttons = [...card.querySelectorAll<HTMLElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
      // Escape leaves the card rather than the menu, so it stops here.
      e.preventDefault();
      e.stopPropagation();
      hide();
      trigger.focus();
    }
  }

  // A click from the keyboard carries no pointer, and moves focus into the card.
  trigger.addEventListener('click', (e) => {
    if (card === null) show(e.detail === 0);
    else hide();
  });
  trigger.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight') return;
    e.preventDefault();
    show(true);
  });
  trigger.addEventListener('pointerenter', () => show(false));
  // Pointing at any other row of the menu puts the card away.
  dropdown.addEventListener('pointerover', (e) => {
    const target = e.target as Node | null;
    if (card === null || target === null) return;
    if (trigger.contains(target) || card.contains(target)) return;
    if ((target as Element).closest?.('button')) hide();
  });

  return { hide };
}
