/**
 * A card beside the menu, opened from one entry of a section: Open Recent
 * (#381) and Metadata (#715). Written once for Open Recent and taken out of
 * `menu-recent.ts` when Metadata became the second, so the two cards are placed,
 * entered and left by the same code.
 *
 * The keyboard enters and leaves it sideways: the arrow right, or Enter, from
 * the entry goes in; the arrow left, or Escape, comes back to it. Pointing at
 * the entry shows it, and pointing at any other row of the menu puts it away.
 */

export interface SideCardOptions {
  readonly trigger: HTMLButtonElement;
  readonly dropdown: HTMLElement;
  /** The id of the card, which the entry names in `aria-controls`. */
  readonly id: string;
  /** What a screen reader is told the group of rows is. */
  readonly label: string;
  /** A class of its own, beside the one every side card carries. */
  readonly className: string;
  /** The rows, built as the card is shown, or none when there is nothing to show. */
  readonly rows: () => readonly HTMLButtonElement[];
}

export interface SideCard {
  /** Hide the card, if it is shown. */
  hide(): void;
}

/** The class every such card carries, which the stylesheet draws it by. */
export const SIDE_CARD_CLASS = 'menu-side-card';

export function installSideCard(options: SideCardOptions): SideCard {
  const { trigger, dropdown } = options;
  let card: HTMLElement | null = null;

  function hide(): void {
    card?.remove();
    card = null;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function build(rows: readonly HTMLButtonElement[]): HTMLElement {
    const group = document.createElement('div');
    group.id = options.id;
    group.className = `${SIDE_CARD_CLASS} ${options.className}`;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', options.label);
    for (const row of rows) group.appendChild(row);
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
      const rows = options.rows();
      if (rows.length === 0) return;
      card = build(rows);
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
