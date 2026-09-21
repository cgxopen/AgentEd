/**
 * The «Images» popover as a surface: what it shows while the folder is
 * being read, what it shows afterwards, and what it does with an answer
 * that arrives for a popover the user has already closed.
 *
 * The sentences themselves are pinned in `src/app/assets-summary.test.ts`.
 */

import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import type { AssetsSummary } from '../app/assets-summary';
import { ThemeManager } from '../app/theme-manager';
import { setupAppearanceMenu } from './appearance-menu';
import { ASSETS_POPOVER_LOADING, setupAssetsPopover } from './assets-popover';
import { setupDocumentBadges } from './document-badges';

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

/**
 * The header popovers stay mutually exclusive (#209 review).
 *
 * **The partner changed on #401 and the property did not.** This was written
 * against the context popover, which was positioned by the same
 * `cluster-popover` rule and therefore overlapped this one; that popover has
 * gone, and the appearance popover is the surface still in the bar that this
 * one must not sit under. `appearance-menu.ts` carries the mechanism and
 * explains both halves: an outside-click listener on the capture phase, so it
 * runs before other header controls call `stopPropagation`, and a trigger that
 * does not call `stopPropagation` itself, so opening it closes the others.
 *
 * Measured on `763e611`, before the repair, with the original pair mounted and
 * driven by real clicks: clicking the badge with the other popover open closed
 * nothing, and clicking the other trigger with this popover open closed nothing
 * either. Both directions were broken, for the two different reasons above.
 *
 * Each direction below opens the first popover through its own control and
 * asserts that it is open before touching the second. Asserting only that the
 * other one ended closed would pass against a popover that was never opened,
 * and so against the build this repair fixes.
 *
 * The markup is sliced out of the shipped page rather than retyped, so a
 * control that leaves `index.html` fails this file instead of being quietly
 * mounted by it.
 */
describe('mutual exclusion with the appearance popover', () => {
  function mountPair(): void {
    const open = shippedPage.indexOf('<header id="menubar">');
    const close = shippedPage.indexOf('</header>');
    if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
    document.body.innerHTML = `${shippedPage.slice(open, close + '</header>'.length)}
      <aside id="assets-popover" class="cluster-popover hidden"></aside>
      <aside id="appearance-popover" class="appearance-popover hidden"></aside>`;
  }

  function pair(): void {
    localStorage.clear();
    mountPair();

    const assets = setupAssetsPopover({ loadSummary: async () => COUNTED });
    // The wiring `main.ts` installs: the badge toggles the popover.
    setupDocumentBadges(fakeEditorWithImage(), { onImagesToggle: () => assets.toggle() });
    setupAppearanceMenu(new ThemeManager());
  }

  /** An editor whose document holds an image, which is all the badge asks. */
  function fakeEditorWithImage(): Editor {
    const image = { type: { name: 'image' }, childCount: 0, child: () => image };
    return {
      state: { doc: { type: { name: 'doc' }, childCount: 1, child: () => image } },
    } as unknown as Editor;
  }

  const isOpenById = (id: string): boolean =>
    !(document.getElementById(id) as HTMLElement).classList.contains('hidden');

  const clickOn = (id: string): void => {
    (document.getElementById(id) as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
  };

  it('closes the appearance popover when the badge is clicked', () => {
    pair();

    clickOn('appearance-menu-trigger');
    // The half a lazy assertion would skip: the other popover really is
    // open before the badge is touched.
    expect(isOpenById('appearance-popover')).toBe(true);
    expect(isOpenById('assets-popover')).toBe(false);

    clickOn('badge-images');
    expect(isOpenById('assets-popover')).toBe(true);
    expect(isOpenById('appearance-popover')).toBe(false);
  });

  it('closes when the appearance trigger is clicked', () => {
    pair();

    clickOn('badge-images');
    expect(isOpenById('assets-popover')).toBe(true);
    expect(isOpenById('appearance-popover')).toBe(false);

    clickOn('appearance-menu-trigger');
    expect(isOpenById('appearance-popover')).toBe(true);
    expect(isOpenById('assets-popover')).toBe(false);
  });

  it('still closes by its own badge, which the capture listener must not swallow', () => {
    pair();

    clickOn('badge-images');
    expect(isOpenById('assets-popover')).toBe(true);

    // The ordering trap: capture runs before the badge handler, so a
    // listener that did not excuse its own trigger would close here and
    // let the toggle reopen straight away, leaving the popover with no
    // way to be closed by the control that opened it.
    clickOn('badge-images');
    expect(isOpenById('assets-popover')).toBe(false);
  });
});
