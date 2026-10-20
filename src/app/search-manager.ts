import type { Editor } from '@tiptap/core';
import {
  createSearchEngine,
  type SearchEngine,
  type SearchOptions,
} from '../editor/search-extension';
import { isModHeld, modIsCommand } from '../ui/chord-label';
import { showConfirmDialog } from '../ui/confirm-dialog';
import { type SearchPanel, setupSearchPanel } from '../ui/search-panel';
import { showToast } from '../ui/toast';

export interface SearchManager {
  /** Open the panel in find mode and put the caret in the find field, whether or not it was open. */
  openFind(): void;
  openReplace(): void;
  /**
   * The header button's command (#312): close the panel when it is open,
   * otherwise open it as `openFind` does. Deliberately not what `Ctrl+F`
   * calls — at the keyboard Escape already closes the panel, and a second
   * `Ctrl+F` returns to the find field instead.
   */
  toggleFind(): void;
  close(): void;
  findNext(): void;
  findPrevious(): void;
  replace(): void;
  replaceAll(): Promise<void>;
  installKeyboardListeners(): void;
  isOpen(): boolean;
  /**
   * Call `listener` with the new state every time the panel opens or closes,
   * by any route. Every route reaches the panel through this manager, which is
   * what lets one listener keep the header button's pressed state true.
   */
  onOpenChange(listener: (open: boolean) => void): void;
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
   * dismiss other floating UI (the «Images» popover). */
  onOpen?: () => void;
}

/**
 * The Replace chord, once the key of the chord is held: Ctrl+H where `Mod` is
 * Ctrl, Option+Cmd+F where it is Command (#630). On a Mac Cmd+H is Hide in the
 * application menu, measured to hide AgentEd once the page leaves it, and
 * Option+Cmd+F is Find and Replace in TextEdit, Script Editor and Xcode; the
 * labels say the same through `MAC_CHORDS` in `ui/chord-label.ts`. Option
 * with F reports another character on a Mac, so the physical key is read too.
 */
export function isReplaceChord(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey'>,
  command: boolean = modIsCommand(),
): boolean {
  if (e.shiftKey) return false;
  if (command) return e.altKey && (e.key === 'f' || e.key === 'F' || e.code === 'KeyF');
  return !e.altKey && (e.key === 'h' || e.key === 'H');
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
      panel.setCount(result.error, 'error', result.detail);
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

  const openListeners: Array<(open: boolean) => void> = [];

  /**
   * The match the search was on when the panel closed, 1-based, or 0 when
   * there was none (#384). Closing clears the highlights, so this is what
   * lets F3 go on from where the person was rather than from the first match.
   */
  let closedAt = 0;

  function announceIfChanged(wasOpen: boolean): void {
    const open = panel.isOpen();
    if (open === wasOpen) return;
    for (const listener of openListeners) listener(open);
  }

  function openFromShortcut(mode: 'find' | 'replace'): void {
    const wasOpen = panel.isOpen();
    if (!wasOpen) onOpen?.();
    if (mode === 'replace') panel.openReplace();
    else panel.openFind();
    const q = panel.getQuery();
    if (q) runSearch(q);
    announceIfChanged(wasOpen);
  }

  /**
   * F3, Shift+F3 and Find Next and Find Previous in the Edit menu (#384).
   * With the panel open, one match along. With it closed, the search is over
   * and its highlights gone, so the panel opens again with the text still in
   * its field, the match it was on is made current again, and the step is
   * taken from there. With nothing in the field there is nothing to find,
   * and nothing happens, which is what F3 did before a first search.
   */
  function step(direction: 'next' | 'previous'): void {
    if (!panel.isOpen()) {
      if (!panel.getQuery()) return;
      openFromShortcut('find');
      if (engine.matchCount() === 0) return;
      if (closedAt === 0) {
        // No match was current when it closed: the first match is the next one.
        if (direction === 'next') {
          refreshCount();
          return;
        }
      } else {
        engine.goTo(closedAt);
      }
    }
    if (direction === 'next') engine.findNext();
    else engine.findPrevious();
    refreshCount();
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
    toggleFind() {
      if (panel.isOpen()) manager.close();
      else openFromShortcut('find');
    },
    close() {
      const wasOpen = panel.isOpen();
      if (wasOpen) closedAt = engine.currentIndex();
      panel.close();
      // **A closed panel means the search is over** (#384, owner decision of
      // 2026-09-19): every route here clears the highlights, the cross,
      // Escape in either field and the header button alike. The text of both
      // fields stays, so a panel opened again searches with it, and F3 opens
      // it again from where it was, below.
      engine.clear();
      announceIfChanged(wasOpen);
      editor.commands.focus();
    },
    findNext() {
      step('next');
    },
    findPrevious() {
      step('previous');
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
    onOpenChange(listener) {
      openListeners.push(listener);
    },
    installKeyboardListeners() {
      document.addEventListener('keydown', (e) => {
        // F3 / Shift+F3 — no modifier required. Active while the panel is
        // open, and with it closed whenever its find field holds text, which
        // opens it again (#384). Closing clears the engine, so the field is
        // what is read, not the engine's last query.
        if (e.key === 'F3') {
          if (!panel.isOpen() && !panel.getQuery()) return;
          e.preventDefault();
          if (e.shiftKey) manager.findPrevious();
          else manager.findNext();
          return;
        }
        // Command alone on a Mac, Ctrl or Command elsewhere (#627).
        if (!isModHeld(e)) return;
        if (!e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
          e.preventDefault();
          manager.openFind();
          return;
        }
        if (isReplaceChord(e)) {
          e.preventDefault();
          manager.openReplace();
        }
      });
    },
  };

  return manager;
}
