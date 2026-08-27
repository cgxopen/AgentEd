import { setCloseEnabled } from '../ui/menu';
import type { AppContext } from './context';
import type { DocumentActions } from './document-actions';
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
  document.getElementById('indicator-search')!.addEventListener('click', () => {
    ctx.searchManager.openFind();
  });
  // Token number/unit are hover-only (title tooltips); no click handlers.
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

function renderOverflowPopover(popover: HTMLElement): void {
  popover.innerHTML = '';
  const indicators = Array.from(
    document.querySelectorAll<HTMLElement>('#header-indicators .indicator'),
  );
  for (const ind of indicators) {
    if (!isOfferedInOverflow(ind)) continue;
    const clone = document.createElement('span');
    clone.className = 'indicator';
    clone.textContent = ind.textContent;
    clone.title = ind.title;
    clone.addEventListener('click', () => ind.click());
    popover.appendChild(clone);
  }
  if (popover.childElementCount === 0) {
    const empty = document.createElement('span');
    empty.className = 'indicator indicator-tertiary';
    empty.textContent = 'All indicators visible';
    popover.appendChild(empty);
  }
}
