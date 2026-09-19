/**
 * The files panel tree: built from the flat listing the walk returns, and
 * drawn into the panel (#380 moved it here from `sidebar.ts`, which was past
 * the size guideline, and gave it the mark for a file the document does not
 * use). What the panel is, open or closed, and what it says when there is no
 * tree, stays in `sidebar.ts`.
 */
import { isMarkdownPath, joinPath } from '../platform/paths';

export interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children: TreeNode[];
}

export type OnFileClick = (absPath: string, rootPath: string) => void;

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

export function renderTreeRecursive(
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
  entry.dataset.path = joinPath(rootPath, node.path);
  entry.dataset.title = entry.title;

  if (actionable) {
    entry.addEventListener('click', () => {
      onClick(joinPath(rootPath, node.path), rootPath);
    });
  }

  li.appendChild(entry);
}

/**
 * The tooltip line of a file the open document does not use (#380). Grey and
 * a sentence about this document, not a warning: a shared `assets/` folder is
 * the normal convention (R-C12), and the file may be used by the document
 * beside it.
 */
export const NOT_USED_HERE = 'Not used in the current document';

/** The class the stylesheet greys such a file with. */
export const UNUSED_CLASS = 'sidebar-file-unused';

/**
 * Mark every file of the drawn tree that `unused` says so of, by its absolute
 * path, and unmark the rest, tooltip included. Run after every draw and every
 * change to the document; it reads nothing but the tree already on screen.
 */
export function markUnused(tree: HTMLElement, unused: (path: string) => boolean): void {
  for (const entry of tree.querySelectorAll<HTMLElement>('.sidebar-file-entry[data-path]')) {
    const marked = unused(entry.dataset.path as string);
    const title = entry.dataset.title ?? '';
    entry.classList.toggle(UNUSED_CLASS, marked);
    entry.title = marked ? `${title}\n${NOT_USED_HERE}` : title;
  }
}
