import type { ContextCluster } from '../cluster/types';

export interface ClusterIndicatorCallbacks {
  /** Fired when the user clicks the indicator. Toggles the popover. */
  onToggle: () => void;
}

export interface ClusterIndicator {
  /** Update the visible label + visibility from a fresh cluster snapshot. */
  refresh: (cluster: ContextCluster | null) => void;
}

/**
 * Statusbar indicator that surfaces context-cluster discoveries.
 *
 * Hidden when there's no cluster (`null` — pre-load or Web mode) or
 * when the cluster is empty. When visible the label reads
 * "📎 N related"; clicking it toggles the popover via the callback.
 */
export function setupClusterIndicator(callbacks: ClusterIndicatorCallbacks): ClusterIndicator {
  const button = document.getElementById('cluster-indicator') as HTMLButtonElement | null;
  if (!button) {
    // Defensive: tests instantiate without mounting full markup.
    return { refresh: () => {} };
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onToggle();
  });

  function refresh(cluster: ContextCluster | null): void {
    if (!button) return;
    const count = cluster?.relatedCount ?? 0;
    if (cluster === null || count === 0) {
      button.style.display = 'none';
      button.setAttribute('aria-hidden', 'true');
      return;
    }
    button.style.display = '';
    button.removeAttribute('aria-hidden');
    button.textContent = `📎 ${count} related`;
    button.title = `${count} related context file${count === 1 ? '' : 's'} found in this tree`;
  }

  refresh(null);
  return { refresh };
}
