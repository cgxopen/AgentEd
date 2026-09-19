export type SearchPanelMode = 'find' | 'replace';

export interface SearchPanelCallbacks {
  onQueryChange(query: string): void;
  onToggleChange(): void;
  onFindNext(): void;
  onFindPrevious(): void;
  onReplaceSingle(): void;
  onReplaceAll(): void;
  onClose(): void;
}

export interface SearchPanelToggles {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchPanel {
  openFind(): void;
  openReplace(): void;
  close(): void;
  isOpen(): boolean;
  mode(): SearchPanelMode;
  /** Query text currently in the find input. */
  getQuery(): string;
  /** Replacement text currently in the replace input. */
  getReplacement(): string;
  /**
   * Set the count label (`3 of 12` / `No results` / `Pattern not valid`), and the
   * reason behind it as the tooltip. A label with no reason clears the tooltip,
   * so the reason of an earlier error never stays on a later count.
   */
  setCount(text: string, variant?: 'normal' | 'error', reason?: string): void;
  /** Toggle red border + disable nav buttons when regex is invalid. */
  setInvalid(invalid: boolean): void;
  /** Read the three toggle button states. */
  toggles(): SearchPanelToggles;
  /** Focus the find input (and select its text) without scrolling. */
  focusFind(): void;
}

/** Time before a keystroke triggers a fresh search. 150ms feels
 * snappy without flooding the editor with re-decoration on every
 * letter while a long query is typed. */
const QUERY_DEBOUNCE_MS = 150;

export function setupSearchPanel(root: HTMLElement, callbacks: SearchPanelCallbacks): SearchPanel {
  const replaceRow = root.querySelector('.search-row-replace') as HTMLElement;

  const input = root.querySelector<HTMLInputElement>('#search-input')!;
  const replaceInput = root.querySelector<HTMLInputElement>('#search-replace-input')!;
  const count = root.querySelector<HTMLElement>('#search-count')!;
  const toggleCase = root.querySelector<HTMLButtonElement>('#search-toggle-case')!;
  const toggleWord = root.querySelector<HTMLButtonElement>('#search-toggle-word')!;
  const toggleRegex = root.querySelector<HTMLButtonElement>('#search-toggle-regex')!;
  const findPrev = root.querySelector<HTMLButtonElement>('#search-find-prev')!;
  const findNext = root.querySelector<HTMLButtonElement>('#search-find-next')!;
  const closeBtn = root.querySelector<HTMLButtonElement>('#search-close')!;
  const replaceSingle = root.querySelector<HTMLButtonElement>('#search-replace-single')!;
  const replaceAll = root.querySelector<HTMLButtonElement>('#search-replace-all')!;

  let currentMode: SearchPanelMode = 'find';
  let debounceTimer: number | null = null;

  function scheduleQuery(): void {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      callbacks.onQueryChange(input.value);
    }, QUERY_DEBOUNCE_MS);
  }

  input.addEventListener('input', scheduleQuery);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) callbacks.onFindPrevious();
      else callbacks.onFindNext();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      callbacks.onClose();
    }
  });

  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      callbacks.onReplaceAll();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      callbacks.onReplaceSingle();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      callbacks.onClose();
    }
  });

  function bindToggle(btn: HTMLButtonElement): void {
    btn.addEventListener('click', () => {
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', pressed ? 'false' : 'true');
      callbacks.onToggleChange();
    });
  }

  bindToggle(toggleCase);
  bindToggle(toggleWord);
  bindToggle(toggleRegex);

  findPrev.addEventListener('click', () => callbacks.onFindPrevious());
  findNext.addEventListener('click', () => callbacks.onFindNext());
  closeBtn.addEventListener('click', () => callbacks.onClose());
  replaceSingle.addEventListener('click', () => callbacks.onReplaceSingle());
  replaceAll.addEventListener('click', () => callbacks.onReplaceAll());

  function setReplaceVisible(visible: boolean): void {
    replaceRow.hidden = !visible;
  }

  function show(mode: SearchPanelMode): void {
    currentMode = mode;
    setReplaceVisible(mode === 'replace');
    root.hidden = false;
    // Defer focus so the layout settles first — focusing while still
    // hidden can throw in some browsers.
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
  }

  return {
    openFind() {
      show('find');
    },
    openReplace() {
      show('replace');
    },
    close() {
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      root.hidden = true;
    },
    isOpen() {
      return !root.hidden;
    },
    mode() {
      return currentMode;
    },
    getQuery() {
      return input.value;
    },
    getReplacement() {
      return replaceInput.value;
    },
    setCount(text, variant = 'normal', reason) {
      count.textContent = text;
      count.classList.toggle('search-count-error', variant === 'error');
      if (reason) count.title = reason;
      else count.removeAttribute('title');
    },
    setInvalid(invalid) {
      input.classList.toggle('search-input-invalid', invalid);
      findPrev.disabled = invalid;
      findNext.disabled = invalid;
      replaceSingle.disabled = invalid;
      replaceAll.disabled = invalid;
    },
    toggles() {
      return {
        caseSensitive: toggleCase.getAttribute('aria-pressed') === 'true',
        wholeWord: toggleWord.getAttribute('aria-pressed') === 'true',
        regex: toggleRegex.getAttribute('aria-pressed') === 'true',
      };
    },
    focusFind() {
      input.focus({ preventScroll: true });
      input.select();
    },
  };
}

/** Helpers for unit tests / debug code that need the debounce value. */
export const SEARCH_QUERY_DEBOUNCE_MS = QUERY_DEBOUNCE_MS;
