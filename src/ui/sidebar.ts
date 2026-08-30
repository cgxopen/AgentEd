import { isMarkdownPath, joinPath } from '../platform/paths';

export interface Sidebar {
  /**
   * Render a recursive tree rooted at `rootPath`. Click handlers
   * registered via `setOnFileClick` receive absolute paths derived
   * from this root.
   *
   * `opensNonMarkdown` says whether this build can hand a non-markdown
   * file to the host system (#146). It arrives as a value rather than
   * being read here, so this module keeps knowing nothing about which
   * platform it is drawing on — and so a test can drive both answers in
   * one file, where `isTauri` is a module-load constant and would need
   * one file per answer.
   */
  showTree: (
    nodes: TreeNode[],
    rootName: string,
    rootPath: string,
    opensNonMarkdown: boolean,
  ) => void;
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

/**
 * The second line of an inert entry's tooltip (#146).
 *
 * **It states the limit and names no step**, which is the #173 rule: a
 * message names a step only where the step was measured to work, and on
 * the web there is none — nothing in the browser can hand a file to the
 * host system. Exported so a test reads what the user reads rather than
 * a copy of it (#50).
 */
export const NON_MARKDOWN_REASON = 'Only markdown files open from this tree in the browser.';

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
  opensNonMarkdown: boolean,
): void {
  const ul = document.createElement('ul');
  ul.className = depth > 0 ? 'sidebar-tree-children collapsed' : 'sidebar-tree-children';

  for (const node of nodes) {
    const li = document.createElement('li');

    if (node.kind === 'directory') {
      renderFolderNode(li, node, onClick, rootPath, depth, opensNonMarkdown);
    } else {
      renderFileNode(li, node, onClick, rootPath, opensNonMarkdown);
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
  opensNonMarkdown: boolean,
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
    renderTreeRecursive(node.children, li, onClick, rootPath, depth + 1, opensNonMarkdown);
  }
}

/**
 * One file entry. Actionable, or present and inert (#146).
 *
 * **Inert means no listener, not a listener that declines.** On the web
 * there is no way to hand a file to the host system — the File System
 * Access API has no equivalent of a shell open — so the click had
 * nothing to do and did it silently, with an error only in a console
 * the shipped build has no way to show. A click is a question, and
 * silence belongs to what the user already knows (#58, #61, #130). So
 * the question is answered before it is asked: the entry stays in the
 * tree, carries no pointer and no hover, and takes no click.
 *
 * **The reason is on demand and nowhere else.** It is the second line of
 * the title the entry already had, so the path is still there for every
 * entry — on the web the tree is the only view of the folder, and
 * answering an unasked question by removing something the user did ask
 * for would be a poor trade. That two lines render as two lines was
 * measured in both targets before this was written: a Chromium browser,
 * which is the web build's own renderer, and the Tauri webview from the
 * artifact of the probe build on this branch.
 */
function renderFileNode(
  li: HTMLElement,
  node: TreeNode,
  onClick: OnFileClick,
  rootPath: string,
  opensNonMarkdown: boolean,
): void {
  const entry = document.createElement('div');
  entry.textContent = `${fileIcon(node.name, false)} ${node.name}`;

  const actionable = isMarkdownPath(node.name) || opensNonMarkdown;
  entry.className = actionable ? 'sidebar-file-entry' : 'sidebar-file-entry sidebar-file-inert';
  entry.title = actionable ? node.path : `${node.path}\n${NON_MARKDOWN_REASON}`;

  if (actionable) {
    entry.addEventListener('click', () => {
      onClick(joinPath(rootPath, node.path), rootPath);
    });
  }

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

  function showTree(
    nodes: TreeNode[],
    rootName: string,
    rootPath: string,
    opensNonMarkdown: boolean,
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
      opensNonMarkdown,
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
