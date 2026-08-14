import { joinPath } from '../platform/paths';

export interface Sidebar {
  /**
   * Render a recursive tree rooted at `rootPath`. Click handlers
   * registered via `setOnFileClick` receive absolute paths derived
   * from this root.
   */
  showTree: (nodes: TreeNode[], rootName: string, rootPath: string, status: SidebarStatus) => void;
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

export type SidebarStatus = { valid: true } | { valid: false; message: string };

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

  for (const entry of flatEntries) {
    const parts = entry.path.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join('/');
      let child = current.children.find((c) => c.path === partPath);

      if (!child) {
        child = {
          name: parts[i],
          path: partPath,
          kind: isLast ? entry.kind : 'directory',
          children: [],
        };
        current.children.push(child);
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

function renderFileNode(
  li: HTMLElement,
  node: TreeNode,
  onClick: OnFileClick,
  rootPath: string,
): void {
  const entry = document.createElement('div');
  entry.className = 'sidebar-file-entry';
  entry.textContent = `${fileIcon(node.name, false)} ${node.name}`;
  entry.title = node.path;
  entry.addEventListener('click', () => {
    onClick(joinPath(rootPath, node.path), rootPath);
  });
  li.appendChild(entry);
}

function renderStatus(status: SidebarStatus, container: HTMLElement): void {
  container.textContent = status.valid ? '✅ Valid structure' : `⚠️ ${status.message}`;
  container.className = status.valid ? 'sidebar-status-ok' : 'sidebar-status-warn';
}

export function setupSidebar(): Sidebar {
  const panel = document.getElementById('sidebar')!;
  const treeEl = document.getElementById('sidebar-tree')!;
  const statusEl = document.getElementById('sidebar-status')!;
  const closeBtn = document.getElementById('sidebar-close')!;

  // No-op default — replaced by main.ts via setOnFileClick once
  // the document actions are wired.
  let onFileClick: OnFileClick = () => {};

  function hidePanel(): void {
    panel.classList.add('hidden');
  }

  closeBtn.addEventListener('click', hidePanel);

  function showTree(
    nodes: TreeNode[],
    rootName: string,
    rootPath: string,
    status: SidebarStatus,
  ): void {
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
    renderStatus(status, statusEl);
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
