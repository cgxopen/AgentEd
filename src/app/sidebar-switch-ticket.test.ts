/**
 * #380 — a document switch takes a ticket before it reads the folder, and its
 * read draws nothing if anything else was asked of the panel meanwhile.
 *
 * Measured on the #380 step zero before the repair: the panel open, a switch
 * reading, the panel closed by hand, and the panel open again when the read
 * landed. The panel and its tree are the ones `setupSidebar` draws from the
 * shipped markup; the folder is a stub whose reads are held until released.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import type { EntryPresence, PlatformIO } from '../platform/types';
import { shippedElement } from '../test-support/shipped-markup';
import { type Sidebar, setupSidebar } from '../ui/sidebar';
import { refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

/** A folder whose listing waits until `release` is called with its contents. */
function heldFolder(): { io: PlatformIO; release: (names: string[]) => void } {
  let release: (names: string[]) => void = () => {};
  const listed = new Promise<string[]>((resolve) => {
    release = resolve;
  });
  const io = {
    canWriteCompanions: async () => true,
    entryPresence: async (path: string): Promise<EntryPresence> =>
      path.endsWith('/assets') ? 'present' : 'absent',
    listDir: async (dir: string) =>
      (await listed).map((name) => ({ name, path: `${dir}/${name}`, isDirectory: false })),
  } as unknown as PlatformIO;
  return { io, release: (names) => release(names) };
}

let sidebar: Sidebar;

beforeEach(() => {
  document.body.innerHTML = shippedElement(shippedPage, '<aside id="sidebar"');
  sidebar = setupSidebar();
});

afterEach(() => {
  document.body.innerHTML = '';
});

function stateAt(path: string): AppState {
  const state = new AppState();
  state.filePath = path;
  // These rows are about the ticket rather than the trigger, so every
  // document here uses its `assets/` folder — the #402 precondition for a
  // tree, which `main.ts` writes from the editor.
  state.referencesImage = true;
  return state;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const drawnNames = () =>
  [...document.querySelectorAll('.sidebar-file-entry')].map((el) => el.textContent?.split(' ')[1]);

describe('a document switch draws only what is still asked of the panel (#380)', () => {
  it('leaves the panel closed when it was closed by hand while the switch read', async () => {
    sidebar.toggle();
    expect(sidebar.isVisible()).toBe(true);
    const folder = heldFolder();
    const switching = refreshSidebar(stateAt('/doc/note.md'), sidebar, folder.io);
    await settle();

    sidebar.toggle();
    folder.release(['a.png']);
    await switching;

    expect(sidebar.isVisible()).toBe(false);
  });

  it('draws the later of two switches, whichever read lands first', async () => {
    const first = heldFolder();
    const second = heldFolder();
    const one = refreshSidebar(stateAt('/one/note.md'), sidebar, first.io);
    const two = refreshSidebar(stateAt('/two/note.md'), sidebar, second.io);
    await settle();

    second.release(['from-two.png']);
    await two;
    first.release(['from-one.png']);
    await one;

    expect(drawnNames()).toEqual(['from-two.png']);
  });

  it('still opens the panel for a document with structure, as R-C6 has it', async () => {
    expect(sidebar.isVisible()).toBe(false);
    const folder = heldFolder();
    const switching = refreshSidebar(stateAt('/doc/note.md'), sidebar, folder.io);
    folder.release(['a.png']);
    await switching;

    expect(sidebar.isVisible()).toBe(true);
    expect(drawnNames()).toEqual(['a.png']);
  });
});
