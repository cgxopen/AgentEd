/**
 * #366 - the window frame AgentEd draws on Windows, and what its close button
 * goes through.
 *
 * **Said first: the window itself is not observable here.** Whether the bar
 * drags, maximizes, resizes and snaps is the owner pass on Windows. What these
 * rows hold is the part that can be driven: which window the platform hands
 * controls for, and **that the close button reaches the unsaved-changes gate**
 * (R-C3). That row runs the real button, the real `ownWindowFrame`, the real
 * `installCloseGuard` of `TauriIO` and the real `createCloseGuard`; the only
 * stand-in is the Tauri window, which raises the close request the way Tauri
 * does - `close()` asks the listeners, `destroy()` asks nobody.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createCloseGuard } from '../app/close-guard';
import type { DocumentActions } from '../app/document-actions';
import { AppState } from '../app/state';
import { drawWindowFrame } from '../ui/window-frame';

interface CloseEvent {
  prevented: boolean;
  preventDefault(): void;
}

const fakeWindow = {
  decorated: false,
  destroyed: 0,
  listeners: [] as Array<(event: CloseEvent) => Promise<void>>,
  isDecorated: vi.fn(async () => fakeWindow.decorated),
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  onCloseRequested: vi.fn(async (listener: (event: CloseEvent) => Promise<void>) => {
    fakeWindow.listeners.push(listener);
    return () => {};
  }),
  close: vi.fn(async () => {
    const event: CloseEvent = {
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    for (const listener of fakeWindow.listeners) await listener(event);
    if (!event.prevented) fakeWindow.destroyed++;
  }),
  destroy: vi.fn(async () => {
    fakeWindow.destroyed++;
  }),
};

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => fakeWindow }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

import { ownWindowFrame as ownWindowFrameOnWeb } from './index';
import { ownWindowFrame, TauriIO } from './tauri';

function mountHeader(): void {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  document.body.innerHTML = shippedPage.slice(open, close + '</header>'.length);
}

/** The document actions as far as the gate is concerned: the question it asks. */
function asking(answer: boolean): DocumentActions {
  return { confirmWindowClose: vi.fn(async () => answer) } as unknown as DocumentActions;
}

function closeButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>('.window-caption-close');
  if (!button) throw new Error('no close button was drawn');
  return button;
}

beforeEach(() => {
  fakeWindow.decorated = false;
  fakeWindow.destroyed = 0;
  fakeWindow.listeners = [];
  vi.clearAllMocks();
  mountHeader();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('which window the platform hands controls for (#366)', () => {
  it('none for a window the system decorates: Linux and macOS keep their own bar', async () => {
    fakeWindow.decorated = true;
    expect(await ownWindowFrame()).toBeNull();
  });

  it('none on the web build, which has no window to ask and draws nothing', async () => {
    // The harness is web-shaped: `isTauri` is false, so the web path answers
    // before any window is asked.
    expect(await ownWindowFrameOnWeb()).toBeNull();
    expect(fakeWindow.isDecorated).not.toHaveBeenCalled();
  });

  it('the three controls for a window with no native bar, each reaching its own call', async () => {
    const controls = await ownWindowFrame();
    if (!controls) throw new Error('an undecorated window should get controls');
    await controls.minimize();
    await controls.toggleMaximize();
    expect(fakeWindow.minimize).toHaveBeenCalledTimes(1);
    expect(fakeWindow.toggleMaximize).toHaveBeenCalledTimes(1);
  });
});

describe('the drawn close button goes through the unsaved-changes gate (R-C3, #366)', () => {
  async function wire(state: AppState, docActions: DocumentActions): Promise<void> {
    await new TauriIO().installCloseGuard(createCloseGuard(state, docActions));
    const controls = await ownWindowFrame();
    if (!controls) throw new Error('an undecorated window should get controls');
    drawWindowFrame(controls);
  }

  it('asks, and keeps the window when the answer is to stay', async () => {
    const state = new AppState();
    state.setModified(true);
    const docActions = asking(false);
    await wire(state, docActions);

    closeButton().click();
    await vi.waitFor(() => expect(docActions.confirmWindowClose).toHaveBeenCalledTimes(1));

    expect(fakeWindow.close).toHaveBeenCalledTimes(1);
    expect(fakeWindow.destroyed).toBe(0);
  });

  it('asks, and closes once when the answer is to go', async () => {
    const state = new AppState();
    const docActions = asking(true);
    await wire(state, docActions);

    closeButton().click();
    await vi.waitFor(() => expect(fakeWindow.destroyed).toBe(1));

    expect(docActions.confirmWindowClose).toHaveBeenCalledTimes(1);
  });
});
