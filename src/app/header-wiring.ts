import { setCloseEnabled } from '../ui/menu';
import type { Sidebar } from '../ui/sidebar';
import type { AppContext } from './context';
import type { DocumentActions } from './document-actions';
import type { SearchManager } from './search-manager';
import type { AppState } from './state';

export interface HeaderControls {
  setFilename(name: string | null, fullPath?: string | null): void;
  updateCloseEnabled(): void;
  /** Called after every `setFilename`, with the name shown. */
  onFilenameChange(cb: (name: string) => void): void;
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

  const filenameListeners: Array<(name: string) => void> = [];

  function setFilename(name: string | null, fullPath?: string | null): void {
    filenameEl.textContent = name ?? 'Untitled';
    filenameEl.title = fullPath ?? name ?? 'Untitled';
    for (const cb of filenameListeners) cb(name ?? 'Untitled');
  }

  function onFilenameChange(cb: (name: string) => void): void {
    filenameListeners.push(cb);
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

  return { setFilename, updateCloseEnabled, onFilenameChange };
}

/** Second-phase wiring — indicator click handlers that need the full context. */
export function wireHeaderIndicators(ctx: AppContext, _docActions: DocumentActions): void {
  wireSearchButton(ctx.searchManager);
  wireSidebarButton(ctx.sidebar);
  // Token number/unit are hover-only (title tooltips); no click handlers.
}

/**
 * The files panel opens and closes from the last control of the header (#347),
 * which also says which of the two the next press will do.
 *
 * **It is the `wireSearchButton` shape below, deliberately.** Both controls
 * reveal a surface rather than switch an option on, so both say `aria-expanded`
 * with `aria-controls` — the #312 and #324 reading — and a screen reader
 * announces «Files panel, button, expanded» or «collapsed». The lit shade is
 * the one every control in the bar takes since #368, `--hover-overlay-strong`
 * on `.header-edge-button[aria-expanded="true"]`, so every control that reveals
 * a surface says «open» the same way.
 *
 * **The state follows the panel and not the button**, which is what makes it
 * true rather than merely written: the chord, a document switch that draws a
 * tree, and the folder offer all move it, because each of them goes through
 * `setVisible` in `ui/sidebar.ts` and that is what publishes the change.
 *
 * This control sits outside `#header-indicators`, so no collapse breakpoint
 * reaches it and the overflow menu never holds a copy of it — measured at every
 * width from 400 to 1400 px, where the bar overflows at none of them.
 */
export function wireSidebarButton(sidebar: Sidebar): void {
  // Named rather than the `!` its neighbours use, which is the `required` shape
  // of `ui/menu.ts`: without this control the panel has the chord and nothing
  // that says whether it is open, so a markup edit that drops it is a boot
  // failure that names itself rather than a TypeError on the next line.
  const button = document.getElementById('sidebar-toggle');
  if (!button) throw new Error('the header markup has no #sidebar-toggle');
  button.setAttribute('aria-expanded', String(sidebar.isVisible()));
  button.addEventListener('click', () => sidebar.toggle());
  sidebar.onVisibleChange((visible) => {
    button.setAttribute('aria-expanded', String(visible));
  });
}

/**
 * The magnifier is a toggle (#312): it opens the panel when it is closed and
 * closes it when it is open, and it says which while the panel is open, so the
 * next press is not a guess. `Ctrl+F` keeps `openFind`, which returns to the
 * find field; the two are different commands on purpose.
 *
 * **It says it with `aria-expanded`, naming the panel** (#324). It shipped with
 * `aria-pressed`, taken from the option toggles a few centimetres away inside
 * the search panel; the controls that do what this one does — the Images badge
 * and the overflow menu — are in this same bar and each says `aria-expanded`
 * with `aria-controls`. This button reveals a surface rather than switching an
 * option on, so it now says the same thing they do.
 *
 * The state follows the panel rather than the button, so Escape, the close
 * cross, `Ctrl+F` and the Edit menu all move it too. Below the collapse
 * breakpoint the overflow menu holds the only copy of this button a pointer can
 * reach, and that copy is drawn when the menu opens; it is drawn again here
 * when the state changes under an open menu.
 */
export function wireSearchButton(searchManager: SearchManager): void {
  const button = document.getElementById('indicator-search')!;
  button.setAttribute('aria-expanded', String(searchManager.isOpen()));
  button.addEventListener('click', () => searchManager.toggleFind());
  searchManager.onOpenChange((open) => {
    button.setAttribute('aria-expanded', String(open));
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
 * statement — *this is not part of the interface right now*. «Metadata»
 * and «Images» say it on a document that warrants neither, and an
 * indicator that has taken itself out has nothing to offer: its text is
 * whatever it last said, and its click reaches a handler with nothing to
 * show. It is not offered, at any width. The context indicator this was
 * first written against left on #401; the convention outlived it because
 * `ui/document-badges.ts` had already adopted it.
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
 * **It carries whichever state attribute the indicator carries**, so a control
 * below the breakpoint says what the next press will do, as it does in the bar.
 * `aria-expanded` is what the magnifier and the two popover indicators say, and
 * `aria-pressed` is kept here because a copy that dropped it would be the #312
 * defect again the day an indicator is spelled that way. The copy is drawn when
 * the menu opens and does not follow the indicator afterwards; whoever changes
 * a state under an open menu draws it again.
 *
 * Exported for its test.
 */
export function overflowClone(ind: HTMLElement): HTMLElement {
  const clone = document.createElement('span');
  clone.className = 'indicator';
  const text = ind.textContent ?? '';
  clone.textContent = text.trim() !== '' ? text : (ind.getAttribute('aria-label') ?? '');
  clone.title = ind.title;
  for (const attribute of ['aria-expanded', 'aria-pressed']) {
    const state = ind.getAttribute(attribute);
    if (state !== null) clone.setAttribute(attribute, state);
  }
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
