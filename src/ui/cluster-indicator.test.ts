import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextCluster, type ContextFileEntry } from '../cluster/types';
import { setupClusterIndicator } from './cluster-indicator';

function mountIndicator(): HTMLButtonElement {
  document.body.innerHTML = '<button id="cluster-indicator" type="button"></button>';
  return document.getElementById('cluster-indicator') as HTMLButtonElement;
}

function entry(overrides: Partial<ContextFileEntry> = {}): ContextFileEntry {
  return {
    path: '/repo/AGENTS.md',
    filename: 'AGENTS.md',
    kind: 'agents-md',
    direction: 'ancestor',
    distance: 1,
    relativePath: '../AGENTS.md',
    ...overrides,
  };
}

describe('setupClusterIndicator — visibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns a no-op refresh when the DOM target is missing', () => {
    const indicator = setupClusterIndicator({ onToggle: vi.fn() });
    expect(() => indicator.refresh(null)).not.toThrow();
  });

  it('hides the button on a null cluster', () => {
    const button = mountIndicator();
    const indicator = setupClusterIndicator({ onToggle: vi.fn() });
    indicator.refresh(null);
    expect(button.style.display).toBe('none');
    expect(button.getAttribute('aria-hidden')).toBe('true');
  });

  it('hides the button on a cluster with zero entries', () => {
    const button = mountIndicator();
    const indicator = setupClusterIndicator({ onToggle: vi.fn() });
    indicator.refresh(ContextCluster.empty('/x'));
    expect(button.style.display).toBe('none');
  });

  /**
   * #130 — withdrawing it means withdrawing all of it.
   *
   * `refresh` used to set `display:none` and return, one line above the
   * assignment that rewrites the text. So a scan that found nothing left
   * the previous scan's count on the element, and the overflow menu —
   * which copies the text of anything it finds unlaid-out — went on
   * offering `📎 1 related` on a control that would do nothing. Put that
   * `return` back and this goes red.
   */
  it('takes the label and the tooltip with it when the count drops to zero', () => {
    const button = mountIndicator();
    const indicator = setupClusterIndicator({ onToggle: vi.fn() });

    indicator.refresh(new ContextCluster('/x', [entry()]));
    expect(button.textContent).toBe('📎 1 related');

    indicator.refresh(ContextCluster.empty('/x'));

    expect(button.style.display).toBe('none');
    expect(button.getAttribute('aria-hidden')).toBe('true');
    expect(button.textContent).toBe('');
    expect(button.title).toBe('');
  });

  it('takes them with it on a null cluster too — the document switch', () => {
    const button = mountIndicator();
    const indicator = setupClusterIndicator({ onToggle: vi.fn() });

    indicator.refresh(new ContextCluster('/x', [entry(), entry({ path: '/y/AGENTS.md' })]));
    indicator.refresh(null);

    expect(button.textContent).toBe('');
    expect(button.title).toBe('');
  });

  it('comes back with a current label when a later scan finds something', () => {
    const button = mountIndicator();
    const indicator = setupClusterIndicator({ onToggle: vi.fn() });

    indicator.refresh(new ContextCluster('/x', [entry()]));
    indicator.refresh(ContextCluster.empty('/x'));
    indicator.refresh(new ContextCluster('/x', [entry(), entry({ path: '/y/AGENTS.md' })]));

    expect(button.style.display).not.toBe('none');
    expect(button.hasAttribute('aria-hidden')).toBe(false);
    expect(button.textContent).toBe('📎 2 related');
  });

  it('shows the button with a singular label for one related file', () => {
    const button = mountIndicator();
    const indicator = setupClusterIndicator({ onToggle: vi.fn() });
    indicator.refresh(new ContextCluster('/x', [entry()]));
    expect(button.style.display).not.toBe('none');
    expect(button.textContent).toBe('📎 1 related');
    expect(button.title).toBe('1 related context file found in this tree');
  });

  it('shows the button with a plural label for multiple files', () => {
    const button = mountIndicator();
    const indicator = setupClusterIndicator({ onToggle: vi.fn() });
    indicator.refresh(new ContextCluster('/x', [entry(), entry({ path: '/y/AGENTS.md' })]));
    expect(button.textContent).toBe('📎 2 related');
    expect(button.title).toBe('2 related context files found in this tree');
  });
});

describe('setupClusterIndicator — interaction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('invokes onToggle when the button is clicked', () => {
    const button = mountIndicator();
    const onToggle = vi.fn();
    setupClusterIndicator({ onToggle });
    button.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
