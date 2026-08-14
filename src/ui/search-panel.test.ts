import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEARCH_QUERY_DEBOUNCE_MS,
  type SearchPanelCallbacks,
  setupSearchPanel,
} from './search-panel';

function mountPanel(): HTMLElement {
  document.body.innerHTML = `
    <div id="search-panel" hidden>
      <div class="search-row search-row-find">
        <input id="search-input" />
        <button id="search-toggle-case" aria-pressed="false">Aa</button>
        <button id="search-toggle-word" aria-pressed="false">[ab]</button>
        <button id="search-toggle-regex" aria-pressed="false">.*</button>
        <span id="search-count">No results</span>
        <button id="search-find-prev">▲</button>
        <button id="search-find-next">▼</button>
        <button id="search-close">×</button>
      </div>
      <div class="search-row search-row-replace" hidden>
        <input id="search-replace-input" />
        <button id="search-replace-single">Replace</button>
        <button id="search-replace-all">Replace All</button>
      </div>
    </div>
  `;
  return document.getElementById('search-panel') as HTMLElement;
}

function noopCallbacks(): SearchPanelCallbacks {
  return {
    onQueryChange: vi.fn(),
    onToggleChange: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onReplaceSingle: vi.fn(),
    onReplaceAll: vi.fn(),
    onClose: vi.fn(),
  };
}

function dispatchKey(target: Element, key: string, opts: Partial<KeyboardEventInit> = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('setupSearchPanel — open/close', () => {
  beforeEach(() => mountPanel());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts hidden', () => {
    const root = document.getElementById('search-panel') as HTMLElement;
    const panel = setupSearchPanel(root, noopCallbacks());
    expect(panel.isOpen()).toBe(false);
  });

  it('openFind shows the panel with the replace row hidden', () => {
    const root = document.getElementById('search-panel') as HTMLElement;
    const panel = setupSearchPanel(root, noopCallbacks());
    panel.openFind();
    expect(panel.isOpen()).toBe(true);
    expect(panel.mode()).toBe('find');
    const replaceRow = root.querySelector('.search-row-replace') as HTMLElement;
    expect(replaceRow.hidden).toBe(true);
  });

  it('openReplace shows the panel with the replace row visible', () => {
    const root = document.getElementById('search-panel') as HTMLElement;
    const panel = setupSearchPanel(root, noopCallbacks());
    panel.openReplace();
    expect(panel.isOpen()).toBe(true);
    expect(panel.mode()).toBe('replace');
    const replaceRow = root.querySelector('.search-row-replace') as HTMLElement;
    expect(replaceRow.hidden).toBe(false);
  });

  it('close hides the panel', () => {
    const root = document.getElementById('search-panel') as HTMLElement;
    const panel = setupSearchPanel(root, noopCallbacks());
    panel.openFind();
    panel.close();
    expect(panel.isOpen()).toBe(false);
  });
});

describe('setupSearchPanel — keyboard', () => {
  beforeEach(() => mountPanel());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Enter in find input invokes onFindNext', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    dispatchKey(document.getElementById('search-input')!, 'Enter');
    expect(cb.onFindNext).toHaveBeenCalledTimes(1);
  });

  it('Shift+Enter in find input invokes onFindPrevious', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    dispatchKey(document.getElementById('search-input')!, 'Enter', { shiftKey: true });
    expect(cb.onFindPrevious).toHaveBeenCalledTimes(1);
  });

  it('Esc in find input invokes onClose', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    dispatchKey(document.getElementById('search-input')!, 'Escape');
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter in replace input invokes onReplaceSingle', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    dispatchKey(document.getElementById('search-replace-input')!, 'Enter');
    expect(cb.onReplaceSingle).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter in replace input invokes onReplaceAll', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    dispatchKey(document.getElementById('search-replace-input')!, 'Enter', { ctrlKey: true });
    expect(cb.onReplaceAll).toHaveBeenCalledTimes(1);
  });

  it('Esc in replace input invokes onClose', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    dispatchKey(document.getElementById('search-replace-input')!, 'Escape');
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('setupSearchPanel — toggles', () => {
  beforeEach(() => mountPanel());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('case toggle flips aria-pressed and fires onToggleChange', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    const btn = document.getElementById('search-toggle-case') as HTMLButtonElement;
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(cb.onToggleChange).toHaveBeenCalledTimes(1);
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles() reflects all three toggle states', () => {
    const panel = setupSearchPanel(
      document.getElementById('search-panel') as HTMLElement,
      noopCallbacks(),
    );
    (document.getElementById('search-toggle-case') as HTMLButtonElement).click();
    (document.getElementById('search-toggle-regex') as HTMLButtonElement).click();
    expect(panel.toggles()).toEqual({
      caseSensitive: true,
      wholeWord: false,
      regex: true,
    });
  });
});

describe('setupSearchPanel — count + invalid', () => {
  beforeEach(() => mountPanel());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('setCount writes the text and clears the error class by default', () => {
    const panel = setupSearchPanel(
      document.getElementById('search-panel') as HTMLElement,
      noopCallbacks(),
    );
    panel.setCount('3 of 12');
    const count = document.getElementById('search-count') as HTMLElement;
    expect(count.textContent).toBe('3 of 12');
    expect(count.classList.contains('search-count-error')).toBe(false);
  });

  it("setCount('...', 'error') adds the error class", () => {
    const panel = setupSearchPanel(
      document.getElementById('search-panel') as HTMLElement,
      noopCallbacks(),
    );
    panel.setCount('Invalid regex: ...', 'error');
    const count = document.getElementById('search-count') as HTMLElement;
    expect(count.classList.contains('search-count-error')).toBe(true);
  });

  it('setInvalid(true) red-borders the input and disables nav buttons', () => {
    const panel = setupSearchPanel(
      document.getElementById('search-panel') as HTMLElement,
      noopCallbacks(),
    );
    panel.setInvalid(true);
    const input = document.getElementById('search-input') as HTMLInputElement;
    expect(input.classList.contains('search-input-invalid')).toBe(true);
    expect((document.getElementById('search-find-next') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('search-find-prev') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('search-replace-all') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('setInvalid(false) re-enables the nav buttons', () => {
    const panel = setupSearchPanel(
      document.getElementById('search-panel') as HTMLElement,
      noopCallbacks(),
    );
    panel.setInvalid(true);
    panel.setInvalid(false);
    expect((document.getElementById('search-find-next') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('setupSearchPanel — query debounce', () => {
  beforeEach(() => {
    mountPanel();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('coalesces rapid input into a single onQueryChange call', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    const input = document.getElementById('search-input') as HTMLInputElement;
    input.value = 'c';
    input.dispatchEvent(new Event('input'));
    input.value = 'ca';
    input.dispatchEvent(new Event('input'));
    input.value = 'cat';
    input.dispatchEvent(new Event('input'));
    expect(cb.onQueryChange).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(SEARCH_QUERY_DEBOUNCE_MS + 1);
    expect(cb.onQueryChange).toHaveBeenCalledTimes(1);
    expect(cb.onQueryChange).toHaveBeenCalledWith('cat');
  });

  it('drops a pending fire when the panel closes', () => {
    const cb = noopCallbacks();
    const panel = setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    panel.openFind();
    const input = document.getElementById('search-input') as HTMLInputElement;
    input.value = 'cat';
    input.dispatchEvent(new Event('input'));
    panel.close();
    vi.advanceTimersByTime(SEARCH_QUERY_DEBOUNCE_MS + 5);
    expect(cb.onQueryChange).toHaveBeenCalledTimes(0);
  });
});

describe('setupSearchPanel — button clicks', () => {
  beforeEach(() => mountPanel());
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('next button invokes onFindNext', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    (document.getElementById('search-find-next') as HTMLButtonElement).click();
    expect(cb.onFindNext).toHaveBeenCalledTimes(1);
  });

  it('prev button invokes onFindPrevious', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    (document.getElementById('search-find-prev') as HTMLButtonElement).click();
    expect(cb.onFindPrevious).toHaveBeenCalledTimes(1);
  });

  it('close button invokes onClose', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    (document.getElementById('search-close') as HTMLButtonElement).click();
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('replace button invokes onReplaceSingle', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    (document.getElementById('search-replace-single') as HTMLButtonElement).click();
    expect(cb.onReplaceSingle).toHaveBeenCalledTimes(1);
  });

  it('replace all button invokes onReplaceAll', () => {
    const cb = noopCallbacks();
    setupSearchPanel(document.getElementById('search-panel') as HTMLElement, cb);
    (document.getElementById('search-replace-all') as HTMLButtonElement).click();
    expect(cb.onReplaceAll).toHaveBeenCalledTimes(1);
  });
});
