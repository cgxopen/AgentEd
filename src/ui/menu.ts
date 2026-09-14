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
  onUndo: () => void;
  onRedo: () => void;
  onInsertTable: () => void;
  onInsertMedia: () => void;
  onInsertCodeBlock: () => void;
  onInsertChecklist: () => void;
  onInsertHorizontalRule: () => void;
  onInsertMetadata: () => void;
  onInsertEmoji: () => void;
  onToggleSidebar: () => void;
  onAbout: () => void;
}

/**
 * Whether the editor has a step to undo and a step to redo (#295). Read when
 * the menu opens, and only then; `historyAvailability` in
 * `editor/history-routes.ts` records why that moment was chosen.
 */
export interface HistoryAvailability {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/** A section header and the panel below it that it opens and folds. */
interface Section {
  readonly header: HTMLElement;
  readonly panel: HTMLElement;
}

function required(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`the menu markup has no #${id}`);
  return element;
}

/**
 * The sections, read from the markup: every `.menu-section` header names its
 * panel through `aria-controls`. A header whose panel is missing is a markup
 * error and throws here, at boot, rather than leaving a header that opens
 * nothing.
 */
function readSections(dropdown: HTMLElement): Section[] {
  return Array.from(dropdown.querySelectorAll<HTMLElement>('.menu-section'), (header) => ({
    header,
    panel: required(header.getAttribute('aria-controls') as string),
  }));
}

/**
 * The hamburger menu, as an accordion (#294): five section headers, each with
 * its panel directly below it. Pressing a header opens its section, and the
 * headers below slide down; pressing it again folds it. One section is open at
 * a time, so opening one folds any other.
 *
 * Focus follows what was opened. Opening a section moves it to the first
 * entry that can be chosen. The menu always reopens with every section folded.
 * Escape closes the whole menu, which is the owner decision recorded on #294.
 *
 * `readHistory` is required rather than optional, so a caller that forgot it
 * does not build: without it Undo and Redo would stay enabled over nothing.
 */
export function setupMenu(callbacks: MenuCallbacks, readHistory: () => HistoryAvailability): void {
  const toggle = required('menu-toggle');
  const dropdown = required('menu-dropdown');
  const sections = readSections(dropdown);
  const undoEntry = required('menu-undo') as HTMLButtonElement;
  const redoEntry = required('menu-redo') as HTMLButtonElement;

  function isOpen(): boolean {
    return !dropdown.classList.contains('hidden');
  }

  function syncExpanded(): void {
    toggle.setAttribute('aria-expanded', isOpen() ? 'true' : 'false');
  }

  /** Opens the one panel given and folds every other, or folds them all for null. */
  function unfold(open: HTMLElement | null): void {
    for (const section of sections) {
      section.panel.hidden = section.panel !== open;
      section.header.setAttribute('aria-expanded', String(section.panel === open));
    }
  }

  /**
   * Greys Undo and Redo when there is nothing for them to do, so a press is
   * never silent (the #275 shape). It runs as the menu opens, which is before
   * any section can be opened and so before a header moves focus to the first
   * entry that can be chosen: that selector skips disabled entries, and it
   * must read the state this sets rather than the state of the last opening.
   */
  function refreshHistoryEntries(): void {
    const { canUndo, canRedo } = readHistory();
    undoEntry.disabled = !canUndo;
    redoEntry.disabled = !canRedo;
  }

  function open(): void {
    refreshHistoryEntries();
    unfold(null);
    dropdown.classList.remove('hidden');
    syncExpanded();
  }

  /**
   * Hides the menu and folds its sections while it is hidden, so a menu
   * reopened shows no fold running. When focus was inside it, focus goes back
   * to the toggle: hiding an element does not move focus off it, and before
   * #294 a chosen entry kept focus while nobody could see it, so the next Tab
   * started from an invisible place. Focus that had already left the menu
   * stays where it is.
   */
  function close(): void {
    const focusWasInside = dropdown.contains(document.activeElement);
    dropdown.classList.add('hidden');
    unfold(null);
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
    section.header.addEventListener('click', () => {
      if (!section.panel.hidden) {
        unfold(null);
        return;
      }
      unfold(section.panel);
      section.panel.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
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
  bind('menu-undo', callbacks.onUndo);
  bind('menu-redo', callbacks.onRedo);
  bind('menu-insert-table', callbacks.onInsertTable);
  bind('menu-insert-media', callbacks.onInsertMedia);
  bind('menu-insert-code-block', callbacks.onInsertCodeBlock);
  bind('menu-insert-checklist', callbacks.onInsertChecklist);
  bind('menu-insert-horizontal-rule', callbacks.onInsertHorizontalRule);
  bind('menu-insert-metadata', callbacks.onInsertMetadata);
  bind('menu-insert-emoji', callbacks.onInsertEmoji);
  bind('menu-toggle-sidebar', callbacks.onToggleSidebar);
  bind('menu-about', callbacks.onAbout);
}

export function setCloseEnabled(enabled: boolean): void {
  const btn = document.getElementById('menu-close') as HTMLButtonElement;
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = enabled ? 'Close current document' : 'No document to close';
}
