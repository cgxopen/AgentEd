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
   * take the older answer — the same staleness `clusterScanGeneration`
   * guards in `AppState`, at a smaller scale.
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

  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (popover.contains(e.target as Node)) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });
  popover.addEventListener('click', (e) => e.stopPropagation());

  return { toggle, close, isOpen };
}
