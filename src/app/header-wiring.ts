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
 * the AppContext (ModeManager, document actions) that is built after this.
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
  document.getElementById('validate-indicator')!.addEventListener('click', () => {
    ctx.validationPanel.toggle();
  });
  document.getElementById('indicator-search')!.addEventListener('click', () => {
    ctx.searchManager.openFind();
  });
  // Token number/unit are hover-only (title tooltips); no click handlers.
  // The active profile is shown via the click-able profile indicator
  // (src/ui/profile-indicator.ts) wired separately from main.ts.
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

function renderOverflowPopover(popover: HTMLElement): void {
  popover.innerHTML = '';
  const indicators = Array.from(
    document.querySelectorAll<HTMLElement>('#header-indicators .indicator'),
  );
  for (const ind of indicators) {
    if (ind.offsetParent !== null) continue; // visible at current breakpoint
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
