import type { Editor } from '@tiptap/core';
import {
  createSearchEngine,
  type SearchEngine,
  type SearchOptions,
} from '../editor/search-extension';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { type SearchPanel, setupSearchPanel } from '../ui/search-panel';
import { showToast } from '../ui/toast';

export interface SearchManager {
  openFind(): void;
  openReplace(): void;
  close(): void;
  findNext(): void;
  findPrevious(): void;
  replace(): void;
  replaceAll(): Promise<void>;
  installKeyboardListeners(): void;
  isOpen(): boolean;
  /** Exposed for tests. */
  readonly panel: SearchPanel;
}

/** Threshold for the Replace All confirmation dialog. Above this
 * count the user gets a modal before the change happens; below it,
 * the replacement is silent (with a toast). */
const REPLACE_ALL_CONFIRM_THRESHOLD = 50;

export interface SearchManagerDeps {
  editor: Editor;
  panelRoot: HTMLElement;
  /** Called whenever the panel transitions from closed → open. Used to
   * dismiss other floating UI (cluster popover). */
  onOpen?: () => void;
}

export function createSearchManager(deps: SearchManagerDeps): SearchManager {
  const { editor, panelRoot, onOpen } = deps;
  const engine: SearchEngine = createSearchEngine(editor);

  function currentOptions(): SearchOptions {
    return panel.toggles();
  }

  function runSearch(query: string): void {
    if (!query) {
      engine.clear();
      panel.setCount('No results');
      panel.setInvalid(false);
      return;
    }
    const result = engine.search(query, currentOptions());
    if (!result.ok) {
      panel.setCount(`Invalid regex: ${result.error}`, 'error');
      panel.setInvalid(true);
      return;
    }
    panel.setInvalid(false);
    if (result.matches === 0) {
      panel.setCount('No results');
      return;
    }
    panel.setCount(`${engine.currentIndex()} of ${result.matches}`);
  }

  function refreshCount(): void {
    const total = engine.matchCount();
    if (total === 0) {
      panel.setCount('No results');
      return;
    }
    panel.setCount(`${engine.currentIndex()} of ${total}`);
  }

  // Callbacks fired by the panel into the manager. Declared here so
  // the panel can be constructed first, then methods below can
  // reference both `panel` and `engine` freely.
  const panel: SearchPanel = setupSearchPanel(panelRoot, {
    onQueryChange: (q) => runSearch(q),
    onToggleChange: () => runSearch(panel.getQuery()),
    onFindNext: () => {
      engine.findNext();
      refreshCount();
    },
    onFindPrevious: () => {
      engine.findPrevious();
      refreshCount();
    },
    onReplaceSingle: () => manager.replace(),
    onReplaceAll: () => {
      void manager.replaceAll();
    },
    onClose: () => manager.close(),
  });

  function openFromShortcut(mode: 'find' | 'replace'): void {
    const wasOpen = panel.isOpen();
    if (!wasOpen) onOpen?.();
    if (mode === 'replace') panel.openReplace();
    else panel.openFind();
    const q = panel.getQuery();
    if (q) runSearch(q);
  }

  async function performReplaceAll(): Promise<void> {
    const total = engine.matchCount();
    if (total === 0) {
      showToast('No matches to replace', 'info');
      return;
    }
    if (total > REPLACE_ALL_CONFIRM_THRESHOLD) {
      const choice = await showConfirmDialog<'cancel' | 'confirm'>({
        title: 'Replace all matches',
        message: `Replace ${total} occurrences? This action cannot be fully undone.`,
        actions: [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Replace All', value: 'confirm', variant: 'danger' },
        ],
        defaultAction: 'cancel',
      });
      if (choice !== 'confirm') return;
    }
    engine.replaceAll(panel.getReplacement());
    showToast(`Replaced ${total} occurrences`, 'info');
    // After Replace All the document mutated; re-run the current
    // search so the count + highlights reflect the new state.
    runSearch(panel.getQuery());
  }

  const manager: SearchManager = {
    panel,
    openFind() {
      openFromShortcut('find');
    },
    openReplace() {
      openFromShortcut('replace');
    },
    close() {
      panel.close();
      // Intentionally do NOT clear the engine here. Closing the panel
      // hides the UI but keeps the last query + highlights live so
      // F3 / Shift+F3 can keep walking matches without re-opening
      // the panel. The user wipes state by opening the panel and
      // emptying the input (runSearch('') calls engine.clear).
      editor.commands.focus();
    },
    findNext() {
      engine.findNext();
      refreshCount();
    },
    findPrevious() {
      engine.findPrevious();
      refreshCount();
    },
    replace() {
      const total = engine.matchCount();
      if (total === 0) return;
      engine.replace(panel.getReplacement());
      // Run search again so the next match becomes the new "current".
      runSearch(panel.getQuery());
    },
    async replaceAll() {
      await performReplaceAll();
    },
    isOpen() {
      return panel.isOpen();
    },
    installKeyboardListeners() {
      document.addEventListener('keydown', (e) => {
        // F3 / Shift+F3 — no modifier required. Active whenever the
        // engine has a remembered query, so the user can repeat-find
        // after closing the panel.
        if (e.key === 'F3') {
          if (!engine.lastQuery() && !panel.isOpen()) return;
          e.preventDefault();
          if (e.shiftKey) manager.findPrevious();
          else manager.findNext();
          return;
        }
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;
        if (!e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
          e.preventDefault();
          manager.openFind();
          return;
        }
        if (!e.shiftKey && !e.altKey && (e.key === 'h' || e.key === 'H')) {
          e.preventDefault();
          manager.openReplace();
        }
      });
    },
  };

  return manager;
}
