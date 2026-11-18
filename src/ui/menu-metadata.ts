/**
 * Insert → Metadata: one entry that opens a card beside the menu with the two
 * blocks it offers (#715), **Agent instructions** and **Document**, the way
 * Open Recent opens its list.
 *
 * A card rather than two entries, measured on the #715 step zero: with nine
 * entries Insert is already as tall as Edit, the tallest section, and a tenth
 * would have made it 32 px taller than any section; the card adds no row.
 *
 * The person chooses; nothing here looks at the document or its file name.
 */
import type { MetadataBlockKind } from '../templates';
import { installSideCard, type SideCard } from './menu-side-card';

/** The id of the card, which the entry names in `aria-controls`. */
export const METADATA_MENU_ID = 'menu-metadata';

/**
 * The rows of the card, in order: the label and the block each one writes.
 * The order is the order of New from Template since #754, Agent Instructions
 * before Document with Metadata, so the menu and the gallery agree.
 */
export const METADATA_CHOICES: readonly (readonly [string, MetadataBlockKind])[] = [
  ['Agent instructions', 'agent'],
  ['Document', 'document'],
];

export interface MetadataMenuOptions {
  readonly trigger: HTMLButtonElement;
  readonly dropdown: HTMLElement;
  readonly onChoose: (kind: MetadataBlockKind) => void;
  /** Close the whole menu, before the command runs. */
  readonly closeMenu: () => void;
}

export function installMetadataMenu(options: MetadataMenuOptions): SideCard {
  function rows(): HTMLButtonElement[] {
    return METADATA_CHOICES.map(([label, kind]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `menu-insert-metadata-${kind}`;
      button.textContent = label;
      button.addEventListener('click', () => {
        options.closeMenu();
        options.onChoose(kind);
      });
      return button;
    });
  }

  return installSideCard({
    trigger: options.trigger,
    dropdown: options.dropdown,
    id: METADATA_MENU_ID,
    label: 'Metadata blocks',
    className: 'menu-metadata',
    rows,
  });
}
