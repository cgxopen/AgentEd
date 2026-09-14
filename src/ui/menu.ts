export interface MenuCallbacks {
  onNew: () => void;
  onNewFromTemplate: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onClose: () => void;
  onFind: () => void;
  onReplace: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onInsertTable: () => void;
  onInsertMedia: () => void;
  onInsertCodeBlock: () => void;
  onInsertChecklist: () => void;
  onInsertHorizontalRule: () => void;
  onToggleSidebar: () => void;
  onAbout: () => void;
}

/**
 * TEMPORARY, #294 comparison head. The class `menu-variant.ts` sets on
 * `#menu-dropdown` to show the accordion instead of the drill-down. It exists
 * so the owner can compare the two in one build, and it comes out with the
 * losing variant in the following head.
 */
export const MENU_ACCORDION_CLASS = 'menu-accordion';

/** A section entry on the root panel, the panel it opens, and that panel's back entry. */
interface Section {
  readonly entry: HTMLElement;
  readonly panel: HTMLElement;
  readonly back: HTMLElement;
}

function required(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`the menu markup has no #${id}`);
  return element;
}

/**
 * The sections, read from the markup: every root entry names its panel through
 * `aria-controls`, and every panel starts with a `.menu-back` entry. A section
 * without either is a markup error and throws here, at boot, rather than
 * leaving an entry that opens nothing.
 */
function readSections(root: HTMLElement): Section[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[aria-controls]'), (entry) => {
    const panel = required(entry.getAttribute('aria-controls') as string);
    const back = panel.querySelector<HTMLElement>('.menu-back');
    if (!back) throw new Error(`#${panel.id} has no back entry`);
    return { entry, panel, back };
  });
}

/**
 * The hamburger menu, as drill-down (#294): the root panel lists the sections,
 * and choosing one replaces the root with that section inside the same box,
 * `#menu-dropdown`. Only one panel shows at a time, so the menu is as tall as its
 * longest section rather than as all of them together.
 *
 * Focus follows the panel that shows. Opening a section moves it to the first
 * entry that can be chosen; the back entry returns it to the section it came
 * from; the menu always reopens at its root. Escape closes the whole menu, not
 * one level, which is the owner decision recorded on #294.
 */
export function setupMenu(callbacks: MenuCallbacks): void {
  const toggle = required('menu-toggle');
  const dropdown = required('menu-dropdown');
  const root = required('menu-root');
  const sections = readSections(root);

  function isOpen(): boolean {
    return !dropdown.classList.contains('hidden');
  }

  function syncExpanded(): void {
    toggle.setAttribute('aria-expanded', isOpen() ? 'true' : 'false');
  }

  function isAccordion(): boolean {
    return dropdown.classList.contains(MENU_ACCORDION_CLASS);
  }

  /**
   * Shows one panel, or the root alone. In the drill-down the root gives way to
   * the section; in the accordion (temporary, see MENU_ACCORDION_CLASS) the
   * section headers stay and the section opens below its own header, which is
   * where the stylesheet orders it, and the header says whether it is open.
   */
  function show(panel: HTMLElement): void {
    const accordion = isAccordion();
    root.hidden = panel !== root && !accordion;
    for (const section of sections) {
      section.panel.hidden = section.panel !== panel;
      if (accordion) section.entry.setAttribute('aria-expanded', String(!section.panel.hidden));
      else section.entry.removeAttribute('aria-expanded');
    }
  }

  function open(): void {
    show(root);
    dropdown.classList.remove('hidden');
    syncExpanded();
  }

  /**
   * Hides the menu. When focus was inside it, focus goes back to the toggle:
   * hiding an element does not move focus off it, and before #294 a chosen
   * entry kept focus while nobody could see it, so the next Tab started from
   * an invisible place. Focus that had already left the menu stays where it is.
   */
  function close(): void {
    const focusWasInside = dropdown.contains(document.activeElement);
    dropdown.classList.add('hidden');
    syncExpanded();
    if (focusWasInside) toggle.focus();
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen()) close();
    else open();
  });

  document.addEventListener('click', () => {
    if (isOpen()) close();
  });
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  for (const section of sections) {
    section.entry.addEventListener('click', () => {
      // The accordion collapses an open section when its header is pressed again.
      if (isAccordion() && !section.panel.hidden) {
        show(root);
        return;
      }
      show(section.panel);
      section.panel.querySelector<HTMLElement>('button:not(.menu-back):not(:disabled)')?.focus();
    });
    section.back.addEventListener('click', () => {
      show(root);
      section.entry.focus();
    });
  }

  // The menu closes before the command runs, so a command that takes focus
  // itself (the editor, a dialog, the search field) keeps it.
  function bind(id: string, cb: () => void) {
    required(id).addEventListener('click', () => {
      close();
      cb();
    });
  }

  bind('menu-new', callbacks.onNew);
  bind('menu-new-from-template', callbacks.onNewFromTemplate);
  bind('menu-open', callbacks.onOpen);
  bind('menu-save', callbacks.onSave);
  bind('menu-save-as', callbacks.onSaveAs);
  bind('menu-close', callbacks.onClose);
  bind('menu-find', callbacks.onFind);
  bind('menu-replace', callbacks.onReplace);
  bind('menu-find-next', callbacks.onFindNext);
  bind('menu-find-prev', callbacks.onFindPrevious);
  bind('menu-insert-table', callbacks.onInsertTable);
  bind('menu-insert-media', callbacks.onInsertMedia);
  bind('menu-insert-code-block', callbacks.onInsertCodeBlock);
  bind('menu-insert-checklist', callbacks.onInsertChecklist);
  bind('menu-insert-horizontal-rule', callbacks.onInsertHorizontalRule);
  bind('menu-toggle-sidebar', callbacks.onToggleSidebar);
  bind('menu-about', callbacks.onAbout);
}

export function setCloseEnabled(enabled: boolean): void {
  const btn = document.getElementById('menu-close') as HTMLButtonElement;
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = enabled ? 'Close current document' : 'No document to close';
}
