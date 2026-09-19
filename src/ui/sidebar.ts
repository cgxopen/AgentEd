import {
  buildTree,
  markUnused,
  NON_MARKDOWN_REASON,
  type OnFileClick,
  renderTreeRecursive,
  type TreeNode,
} from './sidebar-tree';

export { buildTree, NON_MARKDOWN_REASON, type TreeNode };

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
   * Show the panel holding the answer to a question that found nothing
   * (#184, #354): a folder request, or the panel opened by hand.
   */
  showNothingRelated: () => void;
  /**
   * Show the panel holding the answer for a folder that could not be read
   * (#354). Only an open by hand reaches it; a document switch into the same
   * state stays silent.
   */
  showUnreadable: () => void;
  hide: () => void;
  isVisible: () => boolean;
  /**
   * Close the panel, or open it by hand. **An open by hand is a question**
   * (#354), so it does not bring back what was there: the panel opens holding
   * the reading mark and the handler set with `setOnOpenByHand` draws the
   * answer.
   */
  toggle: () => void;
  /**
   * Whether the draw that `ticket` names is still the latest thing asked of
   * the panel, and the panel is still open. A read that lands after the user
   * closed the panel, or after anything else was drawn, is not drawn.
   */
  isCurrent: (ticket: number) => boolean;
  /**
   * A ticket for a read a document switch starts (#380), asked with
   * `isLatest` before it draws. Until #380 a switch took none, so a read that
   * landed after the panel was closed by hand opened it again. Unlike an open
   * by hand, a switch may draw into a closed panel, which is how the panel
   * appears for a document with structure, so what it asks is only whether
   * anything was asked of the panel since it began: closed or opened by hand,
   * or another switch. Taking one moves the count, so of two switches the
   * later wins whichever read lands first.
   */
  beginSwitch: () => number;
  isLatest: (ticket: number) => boolean;
  /**
   * Whether the panel was last closed by hand (#387). A save redraws the panel
   * and never opens it again once the person closed it: closing is an answer
   * they gave. Opening it by hand forgets it, and so does `forgetClosedByHand`,
   * which the acts R-C6 lets open the panel call: a document arriving, and the
   * folder offer accepted.
   */
  isClosedByHand: () => boolean;
  forgetClosedByHand: () => void;
  /**
   * Grey each file of the tree on screen that `unused` names by its absolute
   * path, and ungrey the rest (#380). It reads nothing but the tree drawn.
   */
  markUnused: (unused: (path: string) => boolean) => void;
  /**
   * Replace the handler run when the panel is opened by hand. It receives the
   * ticket for that open, to ask `isCurrent` before it draws.
   */
  setOnOpenByHand: (handler: (ticket: number) => void) => void;
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

/**
 * The answer when the user asked and nothing is beside the document (#184,
 * #130, #354). Owner wording of 2026-08-30.
 *
 * **It names no step, because the question is finished**: the folder was
 * read, and the answer is complete. That is the case #148's rule is about —
 * a step is named only where one works, and here there is nothing left to do.
 *
 * **It is shown only to whoever asked**, and two acts ask: accepting the
 * folder offer, and opening the panel by hand (#354, the line R-A2 draws for
 * Refresh). A document switch into this state stays silent, because nobody
 * asked; a notice there would be the permanent one #58, #61 and #130 refuse.
 * What separates them is not a flag on the decision but where the knowledge
 * lives — the handler that ran the picker and the open by hand are the only
 * two things that know a question was put.
 */
export const NO_RELATED_ITEMS = 'No related files or folders';

/**
 * The answer to an open by hand when the folder beside the document could
 * not be read (#354). Owner wording of 2026-09-18.
 *
 * Reached on the desktop, where `entryPresence` answers `unknown` because the
 * file system refused the lookup. `NO_RELATED_ITEMS` would be false there:
 * nothing was read, so nothing was established about the folder. It names no
 * step, because none was measured to work (#173).
 */
export const FOLDER_UNREADABLE = 'This folder could not be read';

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
export const NO_FOLDER_ACCESS_OFFER =
  'AgentEd has not been given access to a folder, so it cannot see what is beside this ' +
  'document. Choose one.';

export function setupSidebar(): Sidebar {
  const panel = document.getElementById('sidebar')!;
  const treeEl = document.getElementById('sidebar-tree')!;

  // No-op default — replaced by main.ts via setOnFileClick once
  // the document actions are wired.
  let onFileClick: OnFileClick = () => {};
  let onRequestAccess: () => void = () => {};
  let onOpenByHand: (ticket: number) => void = () => {};
  const visibleListeners: Array<(visible: boolean) => void> = [];
  /**
   * Counts what has been asked of the panel (#354). Every hide and every draw
   * moves it, so a ticket taken at an open by hand is current only while
   * nothing has happened to the panel since.
   */
  let generation = 0;
  let closedByHand = false;

  /** Empty the panel for the next thing drawn in it, and count that. */
  function clear(): void {
    generation++;
    treeEl.innerHTML = '';
    treeEl.removeAttribute('aria-busy');
  }

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
    clear();
  }

  function showTree(
    nodes: TreeNode[],
    rootName: string,
    rootPath: string,
    opensNonMarkdown: boolean,
  ): void {
    clear();
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

  /**
   * Open by hand: the panel opens at once, holding the reading mark, and the
   * handler draws the answer when the folder has been read (#354).
   *
   * **The mark is drawn at once and seen only after 200 ms** — the delay is
   * in the stylesheet, on `.sidebar-reading` — so a folder of ordinary size is
   * drawn before anything appears, and only a slow read shows it (owner
   * decision of 2026-09-18). `aria-busy` says the same to a screen reader.
   */
  function openByHand(): void {
    clear();
    const mark = document.createElement('div');
    mark.className = 'sidebar-reading';
    mark.setAttribute('aria-hidden', 'true');
    treeEl.appendChild(mark);
    treeEl.setAttribute('aria-busy', 'true');
    setVisible(true);
    onOpenByHand(generation);
  }

  function toggle(): void {
    if (panel.classList.contains('hidden')) {
      closedByHand = false;
      openByHand();
    } else {
      closedByHand = true;
      hidePanel();
    }
  }

  function isCurrent(ticket: number): boolean {
    return ticket === generation && !panel.classList.contains('hidden');
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
    showNote(NO_RELATED_ITEMS);
  }

  function showUnreadable(): void {
    showNote(FOLDER_UNREADABLE);
  }

  /** One of the two answers that are a sentence and nothing else. */
  function showNote(text: string): void {
    clear();
    const note = document.createElement('div');
    note.className = 'sidebar-note';
    note.textContent = text;
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
    clear();
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
    showUnreadable,
    hide: hidePanel,
    isVisible: () => !panel.classList.contains('hidden'),
    toggle,
    isCurrent,
    beginSwitch: () => {
      generation += 1;
      return generation;
    },
    isLatest: (ticket) => ticket === generation,
    isClosedByHand: () => closedByHand,
    forgetClosedByHand: () => {
      closedByHand = false;
    },
    markUnused: (unused) => markUnused(treeEl, unused),
    setOnOpenByHand: (handler) => {
      onOpenByHand = handler;
    },
    onVisibleChange: (listener) => {
      visibleListeners.push(listener);
    },
    setOnFileClick,
    setOnRequestAccess,
  };
}
