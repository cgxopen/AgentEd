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
  onSelectAll: () => void;
  onInsertTable: () => void;
  onInsertMedia: () => void;
  onInsertCodeBlock: () => void;
  onInsertChecklist: () => void;
  onInsertHorizontalRule: () => void;
  onInsertMetadata: () => void;
  onInsertEmoji: () => void;
  onImageDescription: () => void;
  onAddRowAbove: () => void;
  onAddRowBelow: () => void;
  onDeleteRow: () => void;
  onAddColumnBefore: () => void;
  onAddColumnAfter: () => void;
  onDeleteColumn: () => void;
  onDeleteTable: () => void;
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

/**
 * Which entries can be chosen where the caret is, keyed by the entry. Read
 * when the menu opens, the way the history is (#292, #291).
 *
 * Two modules answer it and neither knows about the other:
 * `tableShapeAvailability` in `editor/table-shape.ts` for the seven Table
 * entries, and `imageDescriptionAvailability` in `editor/image-description.ts`
 * for the eighth entry of Edit. Each records what its rules refuse and why.
 */
export type EntryAvailability = Readonly<Record<string, boolean>>;

/**
 * Every entry that is greyed from that reading, with the key it is greyed
 * from — the seven of the Table section and the image description in Edit.
 * The ids are the markup's, and a key the reading does not carry greys its
 * entry: a reading that forgot one fails safe, rather than offering a route
 * that would do nothing.
 */
const GREYABLE_ENTRIES: ReadonlyArray<readonly [id: string, key: string]> = [
  ['menu-image-description', 'imageDescription'],
  ['menu-table-add-row-above', 'addRowAbove'],
  ['menu-table-add-row-below', 'addRowBelow'],
  ['menu-table-delete-row', 'deleteRow'],
  ['menu-table-add-column-before', 'addColumnBefore'],
  ['menu-table-add-column-after', 'addColumnAfter'],
  ['menu-table-delete-column', 'deleteColumn'],
  ['menu-table-delete-table', 'deleteTable'],
];

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
 * its panel directly below it — five, then six when #292 gave the shape of a
 * table a section of its own, and five again since #347 moved the one entry of
 * View onto a header control. Pressing a header opens its section, and the
 * headers below slide down; pressing it again folds it. One section is open at
 * a time, so opening one folds any other.
 *
 * Focus follows what was opened. Opening a section moves it to the first
 * entry that can be chosen. The menu always reopens with every section folded.
 * Escape closes the whole menu, which is the owner decision recorded on #294.
 *
 * `readHistory` and `readAvailability` are required rather than optional, so a
 * caller that forgot one does not build: without them Undo, Redo, the seven
 * Table entries and the image description would stay enabled over nothing.
 */
export function setupMenu(
  callbacks: MenuCallbacks,
  readHistory: () => HistoryAvailability,
  readAvailability: () => EntryAvailability,
): void {
  const toggle = required('menu-toggle');
  const dropdown = required('menu-dropdown');
  const sections = readSections(dropdown);
  const undoEntry = required('menu-undo') as HTMLButtonElement;
  const redoEntry = required('menu-redo') as HTMLButtonElement;
  const greyableEntries = GREYABLE_ENTRIES.map(
    ([id, key]) => [required(id) as HTMLButtonElement, key] as const,
  );

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
   * Greys every entry that has nothing to do, so a press is never silent (the
   * #275 shape): Undo and Redo from the history (#295), and the seven Table
   * entries and the image description from where the caret is (#292, #291).
   *
   * **It runs as the menu opens, which is before any section can be opened and
   * so before a header moves focus to the first entry that can be chosen: that
   * selector skips disabled entries, and it must read the state this sets
   * rather than the state of the last opening.** Until #292 that order had no
   * witness — STATUS recorded it as such — because Undo and Redo are the fifth
   * and sixth entries of Edit, and Find is enabled whichever way they are
   * greyed. **Add Row Above is the first entry of the Table section and is
   * greyed with the caret in a header row**, so the order is asserted now: a
   * row in `menu.test.ts` opens that section and expects focus on Add Row
   * Below.
   */
  function refreshEntries(): void {
    const { canUndo, canRedo } = readHistory();
    undoEntry.disabled = !canUndo;
    redoEntry.disabled = !canRedo;
    const available = readAvailability();
    for (const [entry, key] of greyableEntries) entry.disabled = available[key] !== true;
  }

  function open(): void {
    refreshEntries();
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
  bind('menu-select-all', callbacks.onSelectAll);
  bind('menu-image-description', callbacks.onImageDescription);
  bind('menu-insert-table', callbacks.onInsertTable);
  bind('menu-insert-media', callbacks.onInsertMedia);
  bind('menu-insert-code-block', callbacks.onInsertCodeBlock);
  bind('menu-insert-checklist', callbacks.onInsertChecklist);
  bind('menu-insert-horizontal-rule', callbacks.onInsertHorizontalRule);
  bind('menu-insert-metadata', callbacks.onInsertMetadata);
  bind('menu-insert-emoji', callbacks.onInsertEmoji);
  bind('menu-table-add-row-above', callbacks.onAddRowAbove);
  bind('menu-table-add-row-below', callbacks.onAddRowBelow);
  bind('menu-table-delete-row', callbacks.onDeleteRow);
  bind('menu-table-add-column-before', callbacks.onAddColumnBefore);
  bind('menu-table-add-column-after', callbacks.onAddColumnAfter);
  bind('menu-table-delete-column', callbacks.onDeleteColumn);
  bind('menu-table-delete-table', callbacks.onDeleteTable);
  bind('menu-about', callbacks.onAbout);
}

export function setCloseEnabled(enabled: boolean): void {
  const btn = document.getElementById('menu-close') as HTMLButtonElement;
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = enabled ? 'Close current document' : 'No document to close';
}
