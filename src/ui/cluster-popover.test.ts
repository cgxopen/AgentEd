/**
 * The popover had no test at all until #130, which is why the issue
 * behind it was filed against a guess.
 *
 * These drive the **real** popover and the **real** indicator, wired the
 * way `main.ts` wires them, over the **real** `WebIO` with only the
 * directory handle constructed — the method #126 and #127 used. Two of
 * them are the floor this change is creating rather than protecting:
 *
 *  - **The working case.** Grant in place, click opens, the entry is
 *    listed, the preview hydrates from the file. Nothing covered this,
 *    so a fix for the broken case could have broken it unnoticed.
 *  - **The revoked-grant case as it actually behaves.** The popover
 *    opens and the previews read `(unavailable)`. #130 was filed
 *    believing the popover stopped opening once the grant was gone;
 *    measurement said otherwise, and this is what stops the belief
 *    coming back.
 *
 * The mutation the last group is here to catch: take
 * `callbacks.onNothingToShow()` out of `toggle` and the branch is silent
 * again, which is the whole defect.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectContextCluster } from '../cluster/detector';
import { ContextCluster, type ContextFileEntry } from '../cluster/types';
import type { PlatformIO } from '../platform/types';
import { WebIO } from '../platform/web';
import { setupClusterIndicator } from './cluster-indicator';
import { setupClusterPopover } from './cluster-popover';

function dom(name: string): DOMException {
  return new DOMException(`stub: ${name}`, name);
}

/**
 * A granted folder holding `doc/`, whose contents are readable — and a
 * switch that takes the grant away without replacing the handle, which
 * is what `chrome://settings/content/filesystem` does to a live tab.
 * `getFileHandle` on the root answers `TypeMismatchError` for `doc`
 * because it is a directory: the step `navigateTo` walks past.
 */
function grantedTree(inDoc: string[], revoked: { value: boolean }): unknown {
  const guard = (): void => {
    if (revoked.value) throw dom('NotAllowedError');
  };
  const doc = {
    values: () => ({
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next: async () => {
            guard();
            return i >= inDoc.length
              ? { done: true, value: undefined }
              : { done: false, value: { name: inDoc[i++], kind: 'file' } };
          },
        };
      },
    }),
    getFileHandle: async (n: string) => {
      guard();
      if (!inDoc.includes(n)) throw dom('NotFoundError');
      return {
        // A real `Blob` rather than an object with a `text` method: the
        // platform reads bytes and decodes them itself (#259), which is
        // what a browser `getFile` hands back and what this now models.
        getFile: async () => new Blob(['# Project rules\n\nThe line a reader actually wants.\n']),
      };
    },
    getDirectoryHandle: async (): Promise<never> => {
      guard();
      throw dom('NotFoundError');
    },
  };
  return {
    getFileHandle: async (n: string) => {
      guard();
      if (n === 'doc') throw dom('TypeMismatchError');
      throw dom('NotFoundError');
    },
    getDirectoryHandle: async (n: string) => {
      guard();
      if (n !== 'doc') throw dom('NotFoundError');
      return doc;
    },
  };
}

function webIO(dirHandle: unknown): PlatformIO {
  const io = new WebIO();
  (io as unknown as { dirHandle: unknown }).dirHandle = dirHandle;
  return io;
}

/** The two elements `index.html` ships, in the state it ships them. */
function mount(): HTMLButtonElement {
  document.body.innerHTML = `
    <button id="cluster-indicator" type="button" class="indicator"
            style="display:none" aria-hidden="true" aria-expanded="false"></button>
    <aside id="cluster-popover" class="cluster-popover hidden" role="dialog"></aside>`;
  return document.getElementById('cluster-indicator') as HTMLButtonElement;
}

interface Rig {
  button: HTMLButtonElement;
  popover: HTMLElement;
  show: (cluster: ContextCluster | null) => void;
  onNothingToShow: ReturnType<typeof vi.fn>;
  isOpen: () => boolean;
}

/** The wiring in `main.ts`, minus the parts a click never reaches. */
function rig(io: PlatformIO): Rig {
  const button = mount();
  const popoverEl = document.getElementById('cluster-popover') as HTMLElement;
  const onNothingToShow = vi.fn();
  let current: ContextCluster | null = null;

  const indicator = setupClusterIndicator({ onToggle: () => popover.toggle(current) });
  const popover = setupClusterPopover({
    getIO: async () => io,
    onOpenEntry: async () => {},
    onRefresh: async () => {},
    onNothingToShow,
  });

  return {
    button,
    popover: popoverEl,
    show: (cluster) => {
      current = cluster;
      indicator.refresh(cluster);
    },
    onNothingToShow,
    isOpen: () => !popoverEl.classList.contains('hidden'),
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

function entry(overrides: Partial<ContextFileEntry> = {}): ContextFileEntry {
  return {
    path: 'doc/CLAUDE.md',
    filename: 'CLAUDE.md',
    kind: 'claude-md',
    direction: 'self',
    distance: 0,
    relativePath: 'CLAUDE.md',
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the popover with a grant in place — the floor', () => {
  it('opens on the click, lists the entry, and hydrates its preview', async () => {
    const revoked = { value: false };
    const io = webIO(grantedTree(['doc.md', 'CLAUDE.md'], revoked));
    const r = rig(io);
    r.show(await detectContextCluster('doc/notes.md', io));

    expect(r.button.textContent).toBe('📎 1 related');

    r.button.click();
    await settle();

    expect(r.isOpen()).toBe(true);
    expect(r.popover.querySelector('.cluster-popover-header')?.textContent).toBe(
      'Related context files',
    );
    expect(r.popover.querySelector('.cluster-entry-filename')?.textContent).toBe('CLAUDE.md');
    expect(r.popover.querySelector('.cluster-popover-footer')?.textContent).toContain('1 found');
    // The preview is the first line of the file that carries text, and
    // this one is a heading, so it is the heading's text without the
    // marks (#138). Asserted here as well as in `snippet.test.ts`
    // because this is the only place the rule is observed arriving on
    // screen from a real read rather than from a string.
    expect(r.popover.querySelector('[data-snippet-for]')?.textContent).toBe('Project rules');
    expect(r.onNothingToShow).not.toHaveBeenCalled();
  });

  it('closes again on the second click', async () => {
    const revoked = { value: false };
    const io = webIO(grantedTree(['doc.md', 'CLAUDE.md'], revoked));
    const r = rig(io);
    r.show(await detectContextCluster('doc/notes.md', io));

    r.button.click();
    await settle();
    r.button.click();

    expect(r.isOpen()).toBe(false);
    expect(r.popover.childElementCount).toBe(0);
    expect(r.button.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the popover once the folder grant is gone', () => {
  it('still opens, and says of each preview that it could not be read', async () => {
    // Measured in the browser at 308f214 and pinned here: revoking the
    // grant does **not** stop the popover opening. The issue was filed
    // believing it did. What is lost is the previews, and they say so
    // rather than showing a blank or a stale line.
    const revoked = { value: false };
    const io = webIO(grantedTree(['doc.md', 'CLAUDE.md'], revoked));
    const r = rig(io);
    r.show(await detectContextCluster('doc/notes.md', io));

    revoked.value = true;

    r.button.click();
    await settle();

    expect(r.isOpen()).toBe(true);
    expect(r.popover.querySelector('.cluster-entry-filename')?.textContent).toBe('CLAUDE.md');
    expect(r.popover.querySelector('[data-snippet-for]')?.textContent).toBe('(unavailable)');
    expect(r.onNothingToShow).not.toHaveBeenCalled();
  });
});

describe('the popover asked to open with nothing to show', () => {
  it('says so instead of doing nothing, on an empty cluster', () => {
    // Unreachable by arrangement after #130: at count 0 the indicator is
    // withdrawn completely and the overflow menu does not offer it. It
    // was unreachable by arrangement before #130 too, and the overflow
    // menu handed the user a copy of it anyway.
    const dev = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = rig(webIO(grantedTree([], { value: false })));
    r.show(ContextCluster.empty('doc/notes.md'));

    // The button is withdrawn, so drive `toggle` the way the overflow
    // clone did: a click straight at the element.
    r.button.click();

    expect(r.isOpen()).toBe(false);
    expect(r.onNothingToShow).toHaveBeenCalledTimes(1);
    expect(dev).toHaveBeenCalled();
    dev.mockRestore();
  });

  it('says so on a null cluster too', () => {
    const dev = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = rig(webIO(grantedTree([], { value: false })));
    r.show(null);

    r.button.click();

    expect(r.isOpen()).toBe(false);
    expect(r.onNothingToShow).toHaveBeenCalledTimes(1);
    dev.mockRestore();
  });

  it('does not say it when there is something to show', async () => {
    const r = rig(webIO(grantedTree(['doc.md', 'CLAUDE.md'], { value: false })));
    r.show(new ContextCluster('doc/notes.md', [entry()]));

    r.button.click();
    await settle();

    expect(r.isOpen()).toBe(true);
    expect(r.onNothingToShow).not.toHaveBeenCalled();
  });
});
