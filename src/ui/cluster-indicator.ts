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
 *
 * **Withdrawing it means withdrawing all of it** (#130). This used to
 * set `display:none` and return, leaving the label of the scan before
 * last on the element — so the overflow menu, which copies the text of
 * anything it finds unlaid-out, kept offering `📎 1 related` after the
 * scan behind it had returned nothing, and clicking that copy reached a
 * `toggle` with an empty cluster and did nothing at all. The stale count
 * and the dead control were one defect with one cause: a `return` above
 * the line that rewrites the text.
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
      // Nothing is left describing a count nobody can see: not the
      // label, not the tooltip. `aria-hidden` is also the word the
      // overflow menu reads to tell an indicator this module has
      // withdrawn from one the collapse breakpoint merely took out of
      // the bar (see `renderOverflowPopover`).
      button.style.display = 'none';
      button.setAttribute('aria-hidden', 'true');
      button.textContent = '';
      button.title = '';
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
