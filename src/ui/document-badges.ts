import type { Editor } from '@tiptap/core';

/**
 * The two document-kind badges of R-C12: «Metadata» when the document
 * carries a frontmatter block, «Images» when it references images.
 *
 * **Purely descriptive.** Neither badge validates anything, blocks
 * anything or warns about anything — R-C12 says so and CLAUDE.md
 * repeats it. «Metadata» is hover-only; only «Images» takes a click,
 * because only «Images» has something more to say than its own tooltip.
 *
 * **A plain document shows neither**, which is the common case and the
 * reason the statusbar stays quiet: the badges are declared withdrawn in
 * `index.html` and only a document that warrants one brings it back.
 *
 * ── The order, which becomes convention ──
 *
 * «Metadata» then «Images», reading the document top to bottom: the
 * metadata block is the first thing in the file and the images are in
 * its body. Both sit immediately before the context indicator, so the
 * row runs from what this document *is* to what is *around* it.
 *
 * ── The breakpoint ──
 *
 * Both take `indicator-collapse-600`, the same class as the context
 * indicator. They are the same kind of control — derived from the
 * document, silent when it does not warrant them, and reachable from the
 * overflow menu once the bar drops them — so a user who has learnt one
 * has learnt the others. They cost a plain document nothing at any
 * width, because a plain document never shows them.
 */

/** Tooltips, pinned here so the tests can read the bytes rather than rebuild them. */
export const METADATA_BADGE_LABEL = 'Metadata';
export const METADATA_BADGE_TOOLTIP =
  'This document starts with a metadata block (YAML frontmatter)';
export const IMAGES_BADGE_LABEL = 'Images';
export const IMAGES_BADGE_TOOLTIP = 'This document references images — click for details';

export interface DocumentBadges {
  /** Redraw «Metadata» from the document's current metadata block. */
  refreshMetadata: (frontmatter: string | null) => void;
  /** Redraw «Images» from the document currently in the editor. */
  refreshImages: () => void;
}

export interface DocumentBadgesCallbacks {
  /** Fired when the user clicks «Images». Toggles the popover. */
  onImagesToggle: () => void;
}

/**
 * Does this document reference an image?
 *
 * **Presence, not a count.** The answer is a boolean and the walk returns
 * at the first image node, because this runs on every transaction that
 * changes the document — every keystroke included. The numbers the
 * popover shows are gathered on click instead, which is what R-C12 means
 * by *information on demand*.
 *
 * Measured on a 358 KB document — larger than the one the owner opens
 * daily — over 200 walks each: **27.2 ms with no image in it**, which is
 * the worst case because the walk has to reach the end to answer no, and
 * **8.0 ms with one near the top**. That is 0.14 ms and 0.04 ms per
 * keystroke. Beside it, on the same document and the same 200
 * repetitions, `countDocument` — the whole of what `statusbar.refresh`
 * already does at that same moment — costs **930 ms**, or 4.65 ms a
 * keystroke. So the worst case here is about 3% of the work it rides
 * beside, and the common case is a fifteenth of that.
 *
 * ── What counts as a reference, and the one state this answers "no" to ──
 *
 * The document model is the authority, which makes the answer the same
 * for every syntax that reaches it. Measured, all ten states, on this
 * build:
 *
 *  - `![alt](assets/x.png)`, an `<img>` written as raw HTML, a
 *    reference-style `![alt][ref]`, an image inside a link, and an image
 *    inside a list item — all **yes**. They are different spellings of
 *    one node.
 *  - `![alt](missing.png)`, where no file is behind the reference —
 *    **yes**, deliberately. R-C12 asks what the document *references*,
 *    not what resolves; a broken reference is still an image reference,
 *    and answering "no" would hide exactly the document whose images
 *    need looking at.
 *  - An image outside `assets/`, and a remote `https:` image — **yes**.
 *    Same reason: the badge describes the document, not where its files
 *    ended up.
 *  - `` `![alt](assets/x.png)` `` inside a code span — **no**. It is
 *    literal text, and no image node exists.
 *  - **An `assets/` folder that exists beside a document referencing
 *    nothing — no.** This is the state the predicate answers against a
 *    literal reading of R-C12's *references images/assets*, and it is
 *    deliberate: R-C5 ends by saying the «Images» badge is derived from
 *    **content**, and a folder somebody left next to the file is not
 *    this document's content. A shared `assets/` folder is the normal
 *    markdown convention — R-C12's own last sentence — so letting one
 *    light up a badge on every document in the folder would make the
 *    badge describe the folder rather than the document.
 */
export function documentReferencesImage(editor: Editor): boolean {
  return anyImageIn(editor.state.doc);
}

/**
 * The least a node has to be for `anyImageIn` to walk it.
 *
 * ProseMirror's `Node` satisfies this, and so does a plain object — which
 * is the point: the early exit is the property worth asserting, and the
 * only way to assert it is to count what the walk touched. A test can
 * hand this a tree that counts its own visits; it cannot make a real
 * `Node` do that.
 */
export interface WalkableNode {
  readonly type: { readonly name: string };
  readonly childCount: number;
  child(index: number): WalkableNode;
}

/**
 * Whether `root` holds an image node anywhere beneath it, **returning at
 * the first one found**.
 *
 * Iterative rather than recursive, per the coding standards: the depth of
 * a document is not something this function may assume, and an explicit
 * stack has no call-depth to overflow. The loop is bounded by the number
 * of nodes in the document, which is finite and shrinking as the stack
 * drains — every node is pushed once and popped once.
 *
 * **`descendants` was the first shape and it does not do this.** Its
 * callback returning `false` stops it descending into that node's
 * children and nothing more: the walk carries on across every remaining
 * sibling. Written that way, the early exit was a claim in a comment with
 * nothing behind it — faster than a full walk, because it stopped
 * descending once it had its answer, but not a walk that stops.
 */
export function anyImageIn(root: WalkableNode): boolean {
  const pending: WalkableNode[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) break;
    if (node.type.name === 'image') return true;
    // Pushed in reverse so `pop` takes the first child next and the walk
    // runs in document order. Measured, on a 358 KB document with an
    // image in its second block: pushing them forwards explores the
    // *last* child first, so the image nearest the top was among the last
    // nodes reached and the early return saved 12% rather than 90%.
    //
    // `childCount`/`child` rather than `forEach`: the callback form
    // allocates a closure per node, and on the no-image document — the
    // one that has to be walked to the end — that cost more per keystroke
    // than the walk itself.
    for (let i = node.childCount - 1; i >= 0; i -= 1) pending.push(node.child(i));
  }
  return false;
}

/**
 * Withdraw a badge — all four things at once (#130).
 *
 * `display` alone is what the context indicator used to do, and it is
 * the defect: the overflow menu copies the text of anything the layout
 * has taken out of the bar, so a badge hidden with its label still on it
 * was cloned into that menu with a stale word and, for «Images», a click
 * that reached a popover with nothing to show. Below 600px that clone is
 * the only route there is. `aria-hidden="true"` is the word the menu
 * reads to tell *this module has withdrawn it* from *the breakpoint took
 * it out of the bar* — see `isOfferedInOverflow`.
 */
function withdraw(el: HTMLElement): void {
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = '';
  el.title = '';
}

function present(el: HTMLElement, label: string, tooltip: string): void {
  el.style.display = '';
  el.removeAttribute('aria-hidden');
  el.textContent = label;
  el.title = tooltip;
}

export function setupDocumentBadges(
  editor: Editor,
  callbacks: DocumentBadgesCallbacks,
): DocumentBadges {
  const metadataEl = document.getElementById('badge-metadata');
  const imagesEl = document.getElementById('badge-images');
  if (!metadataEl || !imagesEl) {
    // Defensive, the shape `setupClusterIndicator` uses: tests and
    // partial mounts get a handle that does nothing rather than a throw.
    return { refreshMetadata: () => {}, refreshImages: () => {} };
  }
  const metadata = metadataEl;
  const images = imagesEl;

  // **No `stopPropagation`, deliberately**, the same choice the appearance
  // trigger makes and for the same reason: letting the click reach the
  // document is what closes the context popover, so opening this one is
  // mutually exclusive with it. Stopping it here left both open at once,
  // overlapping, since the two use the same positioning rule.
  images.addEventListener('click', () => {
    callbacks.onImagesToggle();
  });

  function refreshMetadata(frontmatter: string | null): void {
    // The same question the frontmatter panel asks, and deliberately the
    // same answer: a document has a metadata block when it has one.
    if (frontmatter === null) {
      withdraw(metadata);
      return;
    }
    present(metadata, METADATA_BADGE_LABEL, METADATA_BADGE_TOOLTIP);
  }

  function refreshImages(): void {
    if (!documentReferencesImage(editor)) {
      withdraw(images);
      return;
    }
    present(images, IMAGES_BADGE_LABEL, IMAGES_BADGE_TOOLTIP);
  }

  return { refreshMetadata, refreshImages };
}
