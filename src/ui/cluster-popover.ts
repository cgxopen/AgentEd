import { extractSnippet } from '../cluster/snippet';
import type { ContextCluster, ContextFileEntry } from '../cluster/types';
import type { PlatformIO } from '../platform/types';
import { showToast } from './toast';

const SNIPPET_READ_BYTES = 1024;

export interface ClusterPopoverCallbacks {
  /** Resolve the I/O surface — async because the platform impl is loaded lazily. */
  getIO: () => Promise<PlatformIO>;
  /** Open the file at `path`, going through the unsaved-changes safety gate. */
  onOpenEntry: (path: string) => Promise<void>;
  /** Re-run cluster detection for the current document. */
  onRefresh: () => Promise<void>;
  /**
   * Called when the popover is asked to open and has nothing to show.
   *
   * A callback rather than a message written here, because the wording
   * lives in the app layer (#61) and this module renders. Required, not
   * optional: the whole point is that this branch cannot be silent.
   */
  onNothingToShow: () => void;
}

export interface ClusterPopover {
  open: (cluster: ContextCluster) => void;
  close: () => void;
  toggle: (cluster: ContextCluster | null) => void;
  isOpen: () => boolean;
}

/**
 * Popover anchored to the cluster indicator. Renders the entry list
 * with snippet previews and a refresh button.
 *
 * Snippet previews are loaded lazily (on open) by reading the first
 * 1KB of each file in parallel with `Promise.all`. The popover stays
 * usable if a read fails — the entry just shows "(unavailable)".
 */
export function setupClusterPopover(callbacks: ClusterPopoverCallbacks): ClusterPopover {
  const popover = document.getElementById('cluster-popover');
  if (!popover) {
    return { open: () => {}, close: () => {}, toggle: () => {}, isOpen: () => false };
  }

  const indicator = document.getElementById('cluster-indicator');
  let currentCluster: ContextCluster | null = null;

  function isOpen(): boolean {
    return !popover!.classList.contains('hidden');
  }

  function setExpanded(expanded: boolean): void {
    indicator?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function close(): void {
    popover!.classList.add('hidden');
    popover!.replaceChildren();
    currentCluster = null;
    setExpanded(false);
  }

  function open(cluster: ContextCluster): void {
    currentCluster = cluster;
    popover!.replaceChildren(renderHeader(), renderList(cluster), renderFooter(cluster));
    popover!.classList.remove('hidden');
    setExpanded(true);
    void hydrateSnippets(cluster, popover!);
  }

  function toggle(cluster: ContextCluster | null): void {
    if (isOpen()) {
      close();
      return;
    }
    if (cluster && cluster.relatedCount > 0) {
      open(cluster);
      return;
    }
    // **Unreachable by arrangement, and it answers anyway** (#130). At
    // count 0 the indicator is withdrawn completely and the overflow
    // menu does not offer it, so nothing is left to click. That was also
    // true of the arrangement this replaced — the indicator was hidden
    // then too — and the menu quietly handed the user a copy of it. A
    // branch that is unreachable by arrangement and silent by
    // construction is how the next arrangement gets away with it.
    //
    // Anti-regression, same shape as `hydrateSnippets` below: nothing
    // should route a click here, so in dev this is an error, while the
    // user is told the same thing either way.
    if (import.meta.env.DEV) {
      console.error('cluster popover: asked to open with nothing to show');
    }
    callbacks.onNothingToShow();
  }

  // Click outside / Escape to close.
  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (popover!.contains(e.target as Node)) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });
  popover.addEventListener('click', (e) => e.stopPropagation());

  function renderHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'cluster-popover-header';
    header.textContent = 'Related context files';
    return header;
  }

  function renderList(cluster: ContextCluster): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'cluster-popover-list';
    for (const entry of cluster.entries) {
      list.appendChild(renderEntry(entry));
    }
    return list;
  }

  function renderEntry(entry: ContextFileEntry): HTMLElement {
    const li = document.createElement('li');
    li.className = 'cluster-entry';
    li.dataset.path = entry.path;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cluster-entry-button';
    button.title = `Open ${entry.path}`;
    button.addEventListener('click', () => {
      close();
      void callbacks.onOpenEntry(entry.path).catch(console.error);
    });

    button.appendChild(renderTitleRow(entry));
    button.appendChild(renderPathRow(entry));
    button.appendChild(renderSnippetRow(entry));

    li.appendChild(button);
    return li;
  }

  function renderTitleRow(entry: ContextFileEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cluster-entry-title';

    const arrow = document.createElement('span');
    arrow.className = 'cluster-entry-direction';
    arrow.textContent = directionGlyph(entry);
    arrow.title = directionLabel(entry);
    row.appendChild(arrow);

    const filename = document.createElement('span');
    filename.className = 'cluster-entry-filename';
    filename.textContent = entry.filename;
    row.appendChild(filename);

    return row;
  }

  function renderPathRow(entry: ContextFileEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cluster-entry-path';
    row.textContent = entry.relativePath;
    return row;
  }

  function renderSnippetRow(entry: ContextFileEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'cluster-entry-snippet';
    row.dataset.snippetFor = entry.path;
    row.textContent = '…'; // Loading placeholder; replaced by hydrateSnippets.
    return row;
  }

  function renderFooter(cluster: ContextCluster): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'cluster-popover-footer';

    const count = document.createElement('span');
    count.textContent = `${cluster.relatedCount} found`;
    footer.appendChild(count);

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'cluster-popover-refresh';
    refresh.textContent = 'Refresh';
    refresh.title = 'Re-scan the tree for context files';
    refresh.addEventListener('click', () => {
      void callbacks.onRefresh().catch(console.error);
    });
    footer.appendChild(refresh);

    return footer;
  }

  /**
   * Read the first ~1KB of each entry, run the snippet extractor,
   * and patch the placeholder rows. Errors are swallowed per-entry.
   */
  async function hydrateSnippets(cluster: ContextCluster, root: HTMLElement): Promise<void> {
    let io: PlatformIO;
    try {
      io = await callbacks.getIO();
    } catch (e) {
      // Anti-regression: PlatformIO should always resolve post-init, so a
      // rejection here is anomalous. Stay quiet in prod (user already sees
      // a toast + "(unavailable)" placeholders) but escalate to error in
      // dev so the failure surfaces in CI logs and devtools.
      if (import.meta.env.DEV) {
        console.error('cluster popover: getIO failed', e);
      } else {
        console.warn('cluster popover: getIO failed', e);
      }
      replaceLoadingPlaceholders(root, '(unavailable)');
      showToast('Could not load snippet previews', 'warn');
      return;
    }

    const reads = cluster.entries.map(async (entry) => {
      // If the popover already closed (user clicked away during load),
      // bail out — the placeholder DOM is gone.
      if (!isOpen() || currentCluster !== cluster) return;
      const text = await readSnippetContent(io, entry.path);
      if (!isOpen() || currentCluster !== cluster) return;
      const slot = root.querySelector<HTMLElement>(
        `[data-snippet-for="${CSS.escape(entry.path)}"]`,
      );
      if (slot) slot.textContent = text;
    });
    await Promise.all(reads);
  }

  return { open, close, toggle, isOpen };
}

function replaceLoadingPlaceholders(root: HTMLElement, text: string): void {
  const slots = root.querySelectorAll<HTMLElement>('[data-snippet-for]');
  for (const slot of slots) {
    if (slot.textContent === '…') slot.textContent = text;
  }
}

async function readSnippetContent(io: PlatformIO, path: string): Promise<string> {
  let raw: string;
  try {
    raw = await io.readText(path);
  } catch {
    return '(unavailable)';
  }
  // Trim to ~1KB before extracting; the extractor doesn't need more
  // and big files would otherwise sit in memory just to be sliced.
  const head = raw.length <= SNIPPET_READ_BYTES ? raw : raw.slice(0, SNIPPET_READ_BYTES);
  return extractSnippet(head);
}

const DIRECTION_META: Record<
  ContextFileEntry['direction'],
  { glyph: string; label: (e: ContextFileEntry) => string }
> = {
  ancestor: {
    glyph: '↑',
    label: (e) => `Ancestor (${e.distance} level${e.distance === 1 ? '' : 's'} up)`,
  },
  sibling: { glyph: '→', label: () => 'Sibling directory' },
  child: { glyph: '↓', label: () => 'Child directory' },
  self: { glyph: '·', label: () => 'Same directory' },
};

function directionGlyph(entry: ContextFileEntry): string {
  return DIRECTION_META[entry.direction].glyph;
}

function directionLabel(entry: ContextFileEntry): string {
  return DIRECTION_META[entry.direction].label(entry);
}
