/**
 * The «Images» popover as a surface: what it shows while the folder is
 * being read, what it shows afterwards, and what it does with an answer
 * that arrives for a popover the user has already closed.
 *
 * The sentences themselves are pinned in `src/app/assets-summary.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetsSummary } from '../app/assets-summary';
import { ASSETS_POPOVER_LOADING, setupAssetsPopover } from './assets-popover';

function mount(): void {
  document.body.innerHTML = `
    <button id="badge-images" type="button" class="indicator" aria-expanded="false"></button>
    <aside id="assets-popover" class="cluster-popover hidden" role="dialog"></aside>`;
}

const COUNTED: AssetsSummary = {
  imagesInDocument: 3,
  folder: { kind: 'counted', otherFiles: 9 },
};

function popoverEl(): HTMLElement {
  return document.getElementById('assets-popover') as HTMLElement;
}

function badgeEl(): HTMLElement {
  return document.getElementById('badge-images') as HTMLElement;
}

/** A load that resolves when the test says so. */
function deferred(): { promise: Promise<AssetsSummary>; resolve: (s: AssetsSummary) => void } {
  let resolve!: (s: AssetsSummary) => void;
  const promise = new Promise<AssetsSummary>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mount();
});

describe('opening and closing', () => {
  it('shows the sentence once the folder has been read', async () => {
    const popover = setupAssetsPopover({ loadSummary: async () => COUNTED });
    popover.toggle();

    expect(popover.isOpen()).toBe(true);
    expect(badgeEl().getAttribute('aria-expanded')).toBe('true');

    await vi.waitFor(() => {
      expect(popoverEl().textContent).toContain('3 images used by this document');
    });
    expect(popoverEl().textContent).toContain('assets/ holds 9 more files');
  });

  it('says it is counting while the folder is being read', () => {
    const pending = deferred();
    const popover = setupAssetsPopover({ loadSummary: () => pending.promise });
    popover.toggle();
    // The folder read is a directory listing and can take a moment; the
    // popover must not open empty and stay that way.
    expect(popoverEl().textContent).toContain(ASSETS_POPOVER_LOADING);
  });

  it('closes on a second click and empties itself', async () => {
    const popover = setupAssetsPopover({ loadSummary: async () => COUNTED });
    popover.toggle();
    await vi.waitFor(() => expect(popoverEl().textContent).toContain('3 images'));

    popover.toggle();
    expect(popover.isOpen()).toBe(false);
    expect(popoverEl().textContent).toBe('');
    expect(badgeEl().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape', async () => {
    const popover = setupAssetsPopover({ loadSummary: async () => COUNTED });
    popover.toggle();
    await vi.waitFor(() => expect(popoverEl().textContent).toContain('3 images'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popover.isOpen()).toBe(false);
  });
});

describe('an answer that arrives late', () => {
  it('is dropped when the user has already closed the popover', async () => {
    const pending = deferred();
    const popover = setupAssetsPopover({ loadSummary: () => pending.promise });

    popover.toggle();
    popover.close();
    pending.resolve(COUNTED);
    await pending.promise;

    // The read was about a popover that is no longer on screen. Writing
    // it in would put content into a closed surface, and reopening would
    // show a count nobody asked for.
    expect(popover.isOpen()).toBe(false);
    expect(popoverEl().textContent).toBe('');
  });

  it('is dropped when a newer open has replaced it', async () => {
    const first = deferred();
    const second = deferred();
    let call = 0;
    const popover = setupAssetsPopover({
      loadSummary: () => {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      },
    });

    popover.toggle();
    popover.close();
    popover.toggle();

    // The first read lands after the second open. It describes the state
    // of an earlier moment and must not overwrite the newer one.
    first.resolve({ imagesInDocument: 99, folder: { kind: 'counted', otherFiles: 99 } });
    await first.promise;
    expect(popoverEl().textContent).not.toContain('99');

    second.resolve(COUNTED);
    await vi.waitFor(() => expect(popoverEl().textContent).toContain('3 images'));
  });

  it('says so rather than counting for ever when the load rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const popover = setupAssetsPopover({
      loadSummary: async () => {
        throw new Error('the platform layer fell over');
      },
    });
    popover.toggle();

    // `summariseAssets` turns every folder failure into `unknown`, so
    // reaching here means something else broke — and the user must not be
    // left reading "Counting…" (no silent catch).
    await vi.waitFor(() => {
      expect(popoverEl().textContent).toContain('could not be summarised');
    });
    expect(popoverEl().textContent).not.toContain(ASSETS_POPOVER_LOADING);
    vi.restoreAllMocks();
  });
});
