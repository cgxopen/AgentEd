import { joinPath } from '../platform/paths';

export interface Sidebar {
  /**
   * Render a recursive tree rooted at `rootPath`. Click handlers
   * registered via `setOnFileClick` receive absolute paths derived
   * from this root.
   */
  showTree: (nodes: TreeNode[], rootName: string, rootPath: string) => void;
  hide: () => void;
  isVisible: () => boolean;
  toggle: () => void;
  /**
   * Replace the click handler called when the user activates a file
   * entry in the tree. Receives the absolute disk path (joinPath of
   * rootPath + the node's relative path) and the rootPath itself, so
   * the consumer can run path-traversal validation.
   */
  setOnFileClick: (handler: (absPath: string, rootPath: string) => void) => void;
}

export interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children: TreeNode[];
}

type OnFileClick = (absPath: string, rootPath: string) => void;

function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return '\u{1F4C1}';
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name)) return '\u{1F5BC}';
  if (name.endsWith('.json')) return '\u{1F4CB}';
  return '\u{1F4C4}';
}

/** Build TreeNode[] from flat paths */
export function buildTree(
  flatEntries: Array<{ path: string; kind: 'file' | 'directory' }>,
): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'directory', children: [] };

  // Every node built so far, by its full path (#174). It used to be
  // `current.children.find(...)`, which rescans the siblings already built
  // for every segment of every entry: a level holding N entries cost
  // **N(N-1)/2** comparisons — 49,995,000 for a folder of 10,000, measured.
  // The full path names one node in the whole tree, since it carries its
  // own parent chain, so one map answers what a scan of one sibling list
  // answered and nothing about the tree changes.
  const byPath = new Map<string, TreeNode>();

  for (const entry of flatEntries) {
    const parts = entry.path.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join('/');
      let child = byPath.get(partPath);

      if (!child) {
        child = {
          name: parts[i],
          path: partPath,
          kind: isLast ? entry.kind : 'directory',
          children: [],
        };
        current.children.push(child);
        byPath.set(partPath, child);
      }
      current = child;
    }
  }

  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children.length > 0) sortTree(node.children);
  }
}

function renderTreeRecursive(
  nodes: TreeNode[],
  container: HTMLElement,
  onClick: OnFileClick,
  rootPath: string,
  depth: number,
): void {
  const ul = document.createElement('ul');
  ul.className = depth > 0 ? 'sidebar-tree-children collapsed' : 'sidebar-tree-children';

  for (const node of nodes) {
    const li = document.createElement('li');

    if (node.kind === 'directory') {
      renderFolderNode(li, node, onClick, rootPath, depth);
    } else {
      renderFileNode(li, node, onClick, rootPath);
    }

    ul.appendChild(li);
  }
  container.appendChild(ul);
}

function renderFolderNode(
  li: HTMLElement,
  node: TreeNode,
  onClick: OnFileClick,
  rootPath: string,
  depth: number,
): void {
  const toggle = document.createElement('div');
  toggle.className = 'sidebar-folder-toggle';
  toggle.textContent = `${fileIcon(node.name, true)} ${node.name}`;
  toggle.title = node.path;

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('expanded');
    const childUl = li.querySelector(':scope > .sidebar-tree-children');
    if (childUl) childUl.classList.toggle('collapsed');
  });

  li.appendChild(toggle);

  if (node.children.length > 0) {
    renderTreeRecursive(node.children, li, onClick, rootPath, depth + 1);
  }
}

/**
 * **MEASUREMENT PROBE, not the change (#146).** This commit exists to
 * put a two-line `title` in front of the Tauri webview so a person can
 * see whether it renders as two lines, which nothing in the product does
 * today and no test in this repository can observe: a native tooltip is
 * drawn outside the DOM and outside the page's rendering surface.
 *
 * Measured already in a Chromium browser, which is the web target's own
 * renderer: a single-line title renders as one line and a `\n` renders
 * as two, identically whether the newline arrives from JavaScript or
 * from the HTML attribute. The desktop target is WebView2 and has not
 * been measured, and *same engine* is a reading rather than a
 * measurement.
 *
 * The second line is on non-markdown entries only, so the same tree
 * holds a control and a case. **The sentence is not true of this
 * build** — the desktop opens these files with the OS default app — and
 * that is why this commit is an instrument and is replaced by the change
 * itself before any review.
 */
function renderFileNode(
  li: HTMLElement,
  node: TreeNode,
  onClick: OnFileClick,
  rootPath: string,
): void {
  const entry = document.createElement('div');
  entry.className = 'sidebar-file-entry';
  entry.textContent = `${fileIcon(node.name, false)} ${node.name}`;
  const lower = node.name.toLowerCase();
  const isMarkdown = lower.endsWith('.md') || lower.endsWith('.markdown');
  entry.title = isMarkdown
    ? node.path
    : `${node.path}\nOnly markdown files open from this tree in the browser.`;
  entry.addEventListener('click', () => {
    onClick(joinPath(rootPath, node.path), rootPath);
  });
  li.appendChild(entry);
}

export function setupSidebar(): Sidebar {
  const panel = document.getElementById('sidebar')!;
  const treeEl = document.getElementById('sidebar-tree')!;
  const closeBtn = document.getElementById('sidebar-close')!;

  // No-op default — replaced by main.ts via setOnFileClick once
  // the document actions are wired.
  let onFileClick: OnFileClick = () => {};

  function hidePanel(): void {
    panel.classList.add('hidden');
  }

  closeBtn.addEventListener('click', hidePanel);

  function showTree(nodes: TreeNode[], rootName: string, rootPath: string): void {
    treeEl.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'sidebar-root';
    header.textContent = `\u{1F4C4} ${rootName}`;
    treeEl.appendChild(header);
    renderTreeRecursive(
      nodes,
      treeEl,
      (absPath, rootPathArg) => onFileClick(absPath, rootPathArg),
      rootPath,
      0,
    );
    panel.classList.remove('hidden');
  }

  function toggle(): void {
    if (panel.classList.contains('hidden')) {
      panel.classList.remove('hidden');
    } else {
      hidePanel();
    }
  }

  function setOnFileClick(handler: OnFileClick): void {
    onFileClick = handler;
  }

  return {
    showTree,
    hide: hidePanel,
    isVisible: () => !panel.classList.contains('hidden'),
    toggle,
    setOnFileClick,
  };
}
