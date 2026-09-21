import { type AssetsSummary, describeAssets } from '../app/assets-summary';

/**
 * The small informative popover R-C12 hangs off the «Images» badge.
 *
 * *"Information on demand, never a permanent warning"* — so it says what
 * is there and nothing else. No validation, no warning colour, no
 * suggestion that a shared `assets/` folder is a problem: R-C12's last
 * sentence says it is the normal markdown convention, and this popover
 * is the one place a user could be given the opposite impression.
 *
 * It renders a sentence that `describeAssets` composes, so the wording
 * has one home and the tests can pin its bytes.
 */

export interface AssetsPopoverCallbacks {
  /** Gather the numbers. Async: the folder count is a directory read. */
  loadSummary: () => Promise<AssetsSummary>;
}

export interface AssetsPopover {
  toggle: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export const ASSETS_POPOVER_HEADING = 'Images in this document';
/** Shown while the folder read is in flight. */
export const ASSETS_POPOVER_LOADING = 'Counting…';

export function setupAssetsPopover(callbacks: AssetsPopoverCallbacks): AssetsPopover {
  const popoverEl = document.getElementById('assets-popover');
  const badge = document.getElementById('badge-images');
  if (!popoverEl) {
    return { toggle: () => {}, close: () => {}, isOpen: () => false };
  }
  const popover = popoverEl;

  /**
   * Which open this render belongs to. The folder read is async, so a
   * popover closed and reopened while one was in flight would otherwise
   * take the older answer. `AppState` used to guard the same staleness at
   * a larger scale, for the context scan removed on #401; this is the last
   * place in the build that has the problem.
   */
  let generation = 0;

  function isOpen(): boolean {
    return !popover.classList.contains('hidden');
  }

  function setExpanded(expanded: boolean): void {
    badge?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function close(): void {
    popover.classList.add('hidden');
    popover.replaceChildren();
    generation += 1;
    setExpanded(false);
  }

  function render(sentence: string): void {
    const heading = document.createElement('div');
    heading.className = 'cluster-popover-header';
    heading.textContent = ASSETS_POPOVER_HEADING;

    const body = document.createElement('p');
    body.className = 'assets-popover-summary';
    body.textContent = sentence;

    popover.replaceChildren(heading, body);
  }

  function open(): void {
    generation += 1;
    const mine = generation;
    render(ASSETS_POPOVER_LOADING);
    popover.classList.remove('hidden');
    setExpanded(true);

    callbacks
      .loadSummary()
      .then((summary) => {
        // A newer open, or a close, happened while the folder was being
        // read: that answer is no longer about what is on screen.
        if (mine !== generation) return;
        render(describeAssets(summary));
      })
      .catch((e) => {
        // No silent catch (CLAUDE.md): `summariseAssets` already turns
        // every folder failure into `unknown`, so reaching here means
        // something else broke and the user must not be left reading
        // "Counting…" for ever.
        console.error('[agented] could not summarise the images:', e);
        if (mine !== generation) return;
        render('The images in this document could not be summarised.');
      });
  }

  function toggle(): void {
    if (isOpen()) {
      close();
      return;
    }
    open();
  }

  // Capture phase, and the badge below does not stop propagation: the two
  // halves of the mechanism `appearance-menu.ts` documents, which is what
  // keeps the header popovers mutually exclusive.
  //
  // Capture is the half that matters here. A header control that calls
  // `stopPropagation` in its own bubble handler would never let a bubble
  // listener on this popover hear the click, and this popover would stay
  // open underneath whatever the user just opened. The context indicator
  // was the one that did it, until #401 removed it; the appearance trigger
  // is the case the capture phase still answers.
  //
  // **The trigger has to be excused, and the order is why.** Capture runs
  // from the document down, so a click on the badge reaches this listener
  // *before* it reaches the badge handler that toggles. Without the guard
  // below, the badge would close the popover and the toggle would
  // immediately reopen it, and it would never close by its own control
  // again. `appearance-menu.ts` excuses its own button for this reason.
  document.addEventListener(
    'click',
    (e) => {
      if (!isOpen()) return;
      const target = e.target as Node;
      if (popover.contains(target)) return;
      if (badge?.contains(target)) return;
      close();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });
  popover.addEventListener('click', (e) => e.stopPropagation());

  return { toggle, close, isOpen };
}
