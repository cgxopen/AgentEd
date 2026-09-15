import { setCloseEnabled } from '../ui/menu';
import type { AppContext } from './context';
import type { DocumentActions } from './document-actions';
import type { SearchManager } from './search-manager';
import type { AppState } from './state';

export interface HeaderControls {
  setFilename(name: string | null, fullPath?: string | null): void;
  updateCloseEnabled(): void;
}

/**
 * First-phase header setup: grabs DOM refs, wires filename expand toggle,
 * modified-indicator subscription, and overflow popover structure. Leaves
 * indicator click handlers to `wireHeaderIndicators` so they can reference
 * the AppContext that is built after this.
 */
export function setupHeader(state: AppState): HeaderControls {
  const filenameEl = document.getElementById('filename')!;
  const modifiedEl = document.getElementById('modified-indicator')!;

  function setFilename(name: string | null, fullPath?: string | null): void {
    filenameEl.textContent = name ?? 'Untitled';
    filenameEl.title = fullPath ?? name ?? 'Untitled';
  }

  function updateCloseEnabled(): void {
    setCloseEnabled(state.filePath !== null || state.modified);
  }

  filenameEl.addEventListener('click', (e) => {
    e.stopPropagation();
    filenameEl.classList.toggle('expanded');
  });
  document.addEventListener('click', () => {
    filenameEl.classList.remove('expanded');
  });

  state.onModifiedChange((modified) => {
    modifiedEl.classList.toggle('hidden', !modified);
    updateCloseEnabled();
  });

  setupOverflowPopover();

  return { setFilename, updateCloseEnabled };
}

/** Second-phase wiring — indicator click handlers that need the full context. */
export function wireHeaderIndicators(ctx: AppContext, _docActions: DocumentActions): void {
  wireSearchButton(ctx.searchManager);
  // Token number/unit are hover-only (title tooltips); no click handlers.
}

/**
 * The magnifier is a toggle (#312): it opens the panel when it is closed and
 * closes it when it is open, and `aria-pressed` says which while the panel is
 * open, so the next press is not a guess. `Ctrl+F` keeps `openFind`, which
 * returns to the find field; the two are different commands on purpose.
 *
 * The pressed state follows the panel rather than the button, so Escape, the
 * close cross, `Ctrl+F` and the Edit menu all move it too. Below the collapse
 * breakpoint the overflow menu holds the only copy of this button a pointer
 * can reach, and that copy is drawn when the menu opens; it is drawn again
 * here when the state changes under an open menu.
 */
export function wireSearchButton(searchManager: SearchManager): void {
  const button = document.getElementById('indicator-search')!;
  button.setAttribute('aria-pressed', String(searchManager.isOpen()));
  button.addEventListener('click', () => searchManager.toggleFind());
  searchManager.onOpenChange((open) => {
    button.setAttribute('aria-pressed', String(open));
    const popover = document.getElementById('overflow-popover');
    if (popover && !popover.classList.contains('hidden')) renderOverflowPopover(popover);
  });
}

function setupOverflowPopover(): void {
  const toggle = document.getElementById('overflow-toggle')!;
  const popover = document.getElementById('overflow-popover')!;

  function syncExpanded(): void {
    toggle.setAttribute('aria-expanded', popover.classList.contains('hidden') ? 'false' : 'true');
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    renderOverflowPopover(popover);
    popover.classList.toggle('hidden');
    syncExpanded();
  });

  document.addEventListener('click', () => {
    popover.classList.add('hidden');
    syncExpanded();
  });
  popover.addEventListener('click', (e) => e.stopPropagation());
}

/**
 * Whether the overflow menu offers `ind`.
 *
 * Two different facts, and this menu used to know only the second (#130):
 *
 * **Has its own module withdrawn it?** `aria-hidden="true"` is that
 * statement — *this is not part of the interface right now*. The cluster
 * indicator says it whenever a scan finds nothing, and an indicator that
 * has taken itself out has nothing to offer: its text is whatever it
 * last said, and its click reaches a handler with nothing to show. It is
 * not offered, at any width.
 *
 * **Did the collapse breakpoint take it out of the bar?**
 * `offsetParent === null` is that one — and it is the whole reason this
 * menu exists. Such an indicator is live and its text is current.
 *
 * The old single test read `offsetParent === null` alone, which is true
 * of both, so a withdrawn indicator was cloned with its stale label and
 * a dead click. Below 600px that clone is the only route to the popover,
 * so fixing the bar alone would have fixed nothing where this was found.
 *
 * Exported for its test: `offsetParent` is layout, and happy-dom has no
 * layout — it answers `undefined` for every element. The predicate can
 * be driven with both facts set; the menu as a whole cannot.
 */
export function isOfferedInOverflow(ind: HTMLElement): boolean {
  if (ind.getAttribute('aria-hidden') === 'true') return false;
  return ind.offsetParent === null;
}

/**
 * The copy of `ind` the overflow menu shows, forwarding its click to `ind`.
 *
 * **Its text is the indicator's text, or its accessible name when it has
 * none.** The magnifier holds an icon and no text, and a copy of its
 * `textContent` was whitespace: measured in Chromium on `059ade0` at 700 px, a
 * strip 94 by 4 px with a tooltip and nothing to see (#312).
 *
 * **It carries `aria-pressed` when the indicator does**, so a toggle below the
 * breakpoint says what the next press will do, as it does in the bar. The copy
 * is drawn when the menu opens and does not follow the indicator afterwards;
 * whoever changes a pressed state under an open menu draws it again.
 *
 * Exported for its test.
 */
export function overflowClone(ind: HTMLElement): HTMLElement {
  const clone = document.createElement('span');
  clone.className = 'indicator';
  const text = ind.textContent ?? '';
  clone.textContent = text.trim() !== '' ? text : (ind.getAttribute('aria-label') ?? '');
  clone.title = ind.title;
  const pressed = ind.getAttribute('aria-pressed');
  if (pressed !== null) clone.setAttribute('aria-pressed', pressed);
  clone.addEventListener('click', () => ind.click());
  return clone;
}

function renderOverflowPopover(popover: HTMLElement): void {
  popover.innerHTML = '';
  const indicators = Array.from(
    document.querySelectorAll<HTMLElement>('#header-indicators .indicator'),
  );
  for (const ind of indicators) {
    if (!isOfferedInOverflow(ind)) continue;
    popover.appendChild(overflowClone(ind));
  }
  if (popover.childElementCount === 0) {
    const empty = document.createElement('span');
    empty.className = 'indicator indicator-tertiary';
    empty.textContent = 'All indicators visible';
    popover.appendChild(empty);
  }
}
