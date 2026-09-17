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
  /**
   * Show the panel holding the offer of folder access instead of a tree
   * (#184). Only reached where nothing could be looked at.
   */
  showAccessOffer: () => void;
  /**
   * Show the panel holding the answer to a folder request that found
   * nothing (#184). Only the handler that ran the picker calls it.
   */
  showNothingRelated: () => void;
  hide: () => void;
  isVisible: () => boolean;
  toggle: () => void;
  /**
   * Run `listener` whenever the panel opens or closes, with the new state.
   *
   * **The state belongs to the panel, and every route through this module
   * reports it** (#347): the header control that opens it, the chord, and the
   * three `show*` calls a document switch makes. It is the shape
   * `SearchManager.onOpenChange` already has, and for the same reason — the
   * control that says «open» sits in the header, which this module knows
   * nothing about and is not going to start knowing about.
   */
  onVisibleChange: (listener: (visible: boolean) => void) => void;
  /**
   * Replace the click handler called when the user activates a file
   * entry in the tree. Receives the absolute disk path (joinPath of
   * rootPath + the node's relative path) and the rootPath itself, so
   * the consumer can run path-traversal validation.
   */
  setOnFileClick: (handler: (absPath: string, rootPath: string) => void) => void;
  /**
   * Replace the handler run when the user accepts the offer above. It is
   * called from a click, so whatever it does still holds the transient
   * user activation `showDirectoryPicker` requires.
   */
  setOnRequestAccess: (handler: () => void) => void;
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

/**
 * The line drawn where the tree would be when nothing could be looked at
 * (#184). Owner wording of 2026-08-30, and it is also recorded on the
 * issue — two places that can disagree, which is the gap found at the
 * #186 review where the shape was pinned and the sentence was not.
 *
 * **It names its step, and that is not a departure from #173.** That
 * rule bans naming a step which does not work; `showDirectoryPicker`
 * genuinely acquires what this promises, unlike the Save As route
 * measured and rejected there.
 *
 * Exported so a test reads what the user reads rather than a copy of it
 * (#50).
 */
/**
 * The answer when the user asked for a folder and it holds nothing
 * beside the document (#184, #130). Owner wording of 2026-08-30.
 *
 * **It names no step, because the question is finished**: the grant was
 * given, the folder was read, and the answer is complete. That is the
 * case #148's rule is about — a step is named only where one works, and
 * here there is nothing left to do.
 *
 * **It is shown only to whoever asked.** Every other route into this
 * state stays silent, because the user picked that folder themselves
 * and already knows what is in it; a notice there would be the
 * permanent one #58, #61 and #130 refuse. What separates them is not a
 * flag on the decision but where the knowledge lives — the handler that
 * ran the picker is the only thing that knows a question was put.
 */
export const NO_RELATED_ITEMS = 'No related files or folders';

export const NO_FOLDER_ACCESS_OFFER =
  'AgentEd has not been given access to a folder, so it cannot see what is beside this ' +
  'document. Choose one.';

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

  // No-op default — replaced by main.ts via setOnFileClick once
  // the document actions are wired.
  let onFileClick: OnFileClick = () => {};
  let onRequestAccess: () => void = () => {};
  const visibleListeners: Array<(visible: boolean) => void> = [];

  /**
   * The one place the panel is shown or hidden, so the state cannot be
   * changed without being reported (#347).
   *
   * Listeners run on every call rather than only on a change: the cost is one
   * attribute written to the same value, and the alternative is a second
   * record of whether the panel is open, kept beside the class that already
   * answers it. `showTree` reaching an already-open panel is the ordinary case
   * — a document switch redraws the tree without closing anything.
   */
  function setVisible(visible: boolean): void {
    panel.classList.toggle('hidden', !visible);
    for (const listener of visibleListeners) listener(visible);
  }

  /**
   * Hide the panel, and empty it (#184).
   *
   * **A hidden panel holds nothing, so nothing stale can be revealed.**
   * It used to add the class and leave the last render in place, which
   * `toggle` then brought back: after the offer was accepted and the
   * panel hid, opening it by hand showed the same offer line again —
   * still clickable, no longer true, and each click hid the panel again.
   * That was a loop the user could not leave.
   *
   * The line and the tree both clear the root before they draw, so this
   * takes nothing away from either; what it removes is the third state,
   * where the panel is closed and still holding something.
   */
  function hidePanel(): void {
    setVisible(false);
    treeEl.innerHTML = '';
  }

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
    setVisible(true);
  }

  function toggle(): void {
    if (panel.classList.contains('hidden')) setVisible(true);
    else hidePanel();
  }

  function setOnFileClick(handler: OnFileClick): void {
    onFileClick = handler;
  }

  /**
   * The panel, holding the answer rather than a tree or an offer.
   *
   * A plain element and not a button: nothing here is an action, so
   * nothing here takes a click. Built the same way as the other two, so
   * any of the three replaces any other without leaving itself behind.
   */
  function showNothingRelated(): void {
    treeEl.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = NO_RELATED_ITEMS;
    treeEl.appendChild(note);
    setVisible(true);
  }

  function setOnRequestAccess(handler: () => void): void {
    onRequestAccess = handler;
  }

  /**
   * The panel, holding the offer rather than a tree (#184).
   *
   * Built the same way `showTree` builds: the root element is cleared
   * first, so the two can replace each other in either direction without
   * one leaving anything of itself behind.
   */
  function showAccessOffer(): void {
    treeEl.innerHTML = '';
    const offer = document.createElement('button');
    offer.type = 'button';
    offer.className = 'sidebar-access-offer';
    offer.textContent = NO_FOLDER_ACCESS_OFFER;
    // A button, not a styled div: the gesture is an action, so it is one
    // the keyboard and a screen reader can reach on their own terms.
    offer.addEventListener('click', () => onRequestAccess());
    treeEl.appendChild(offer);
    setVisible(true);
  }

  return {
    showTree,
    showAccessOffer,
    showNothingRelated,
    hide: hidePanel,
    isVisible: () => !panel.classList.contains('hidden'),
    toggle,
    onVisibleChange: (listener) => {
      visibleListeners.push(listener);
    },
    setOnFileClick,
    setOnRequestAccess,
  };
}
