/**
 * Dragging an image to a new size, with the mouse (#27).
 *
 * ── What is observable here and what is not, stated first ──
 *
 * The half of this that a user judges is layout: where the four handles sit,
 * whether the outline hugs the picture, whether the drag feels like it is
 * following the pointer. **Nothing in this repository renders CSS**, and
 * `happy-dom` reports `0` for `offsetWidth`, for `naturalWidth` and for every
 * field of `getBoundingClientRect`. So no test here can answer any of it, and
 * saying so first is the point — the manual pass on Windows is where the
 * feature is *verified*, not merely confirmed.
 *
 * What the tests can hold, and do, are the halves that are not layout:
 *
 *  - **The arithmetic**, in `resizedSize` below, which is a pure function of a
 *    start size, a corner and a pointer delta. Every corner, both ratio modes
 *    and the minimum are asserted on it directly.
 *  - **The DOM the node view builds** — that selecting an image produces four
 *    handles and deselecting takes them away — joined to **the selector the
 *    stylesheet uses**, read out of `styles.css` rather than restated, and run
 *    against the element the editor actually rendered. Either half alone
 *    asserts nothing: a test that spells the selector again goes green with the
 *    stylesheet saying something else, and a stylesheet rule pointing at
 *    nothing is not a failure anyone sees.
 *  - **The transaction**, which is where R-C16 lives: one gesture is one undo.
 *
 * ── Why the start size is not read from layout ──
 *
 * `startSizeOf` asks the node first and the loaded image second. That is the
 * right order regardless of any test: a node carrying `width="600"` is 600
 * wide because the document says so, and asking the browser what it painted
 * would hand back whatever `max-width: 100%` had done to it in a narrow
 * window — so a drag begun in a narrow window would jump. It is also what
 * makes a drag drivable in a harness with no layout at all, which is a
 * consequence rather than the reason.
 */
import { closeHistory } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { displayMimeFromName, getImageByUrl } from './image-registry';

/**
 * The smallest an image may be dragged to, in pixels, in **both** directions.
 *
 * Small enough to be a deliberate choice and large enough to stay grabbable:
 * an image dragged to this size still shows four handles a pointer can find,
 * which is what stops an image from being lost by shrinking it to nothing.
 */
export const MIN_IMAGE_SIZE_PX = 24;

/** The corner being dragged. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** All four, in the order they are built. */
export const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];

/** The wrapper the node view puts around the image. */
export const RESIZE_WRAPPER_CLASS = 'image-resize';

/** One corner handle. */
export const RESIZE_HANDLE_CLASS = 'image-resize-handle';

/** Which corner a handle is, as the stylesheet and the pointer code both read it. */
export const CORNER_ATTRIBUTE = 'data-corner';

/**
 * A size in pixels. A `null` height means *derive it from the width*, and a
 * `null` width means *no size at all* — the reset.
 */
export interface ImagePixelSize {
  readonly width: number | null;
  readonly height: number | null;
}

/**
 * What a drag reaches. A drag always arrives at a width, which is why this is
 * a narrower type than the one a commit takes: only a reset has no width, and
 * a reset is not a drag.
 */
export interface DraggedSize {
  readonly width: number;
  readonly height: number | null;
}

/** Everything the arithmetic needs, and nothing about the DOM. */
export interface DragGeometry {
  readonly startWidth: number;
  /** The height at the start, or `0` where the natural size is not known. */
  readonly startHeight: number;
  readonly corner: Corner;
  readonly dx: number;
  readonly dy: number;
  /** Whether the user is holding the modifier that frees the aspect ratio. */
  readonly freeRatio: boolean;
}

/**
 * The size a drag has reached.
 *
 * **Locked is the default and it writes one number.** The height is returned
 * as `null` whenever the ratio is unchanged, because the ratio then derives it
 * — which is what keeps the file carrying one number rather than two that can
 * disagree, and it is why `height: auto` in the stylesheet is left to do its
 * work.
 *
 * A locked drag is driven by whichever axis the pointer moved further along,
 * so dragging a corner sideways and dragging it downwards both work; driving
 * from the width alone would make a purely vertical drag do nothing at all.
 *
 * The minimum applies to **both** dimensions even when only the width is
 * written: for a wide image, a width at the minimum would put the height below
 * it, so the width floor is raised by the ratio.
 */
export function resizedSize(drag: DragGeometry): DraggedSize {
  const growX = drag.corner.endsWith('e') ? drag.dx : -drag.dx;
  const growY = drag.corner.startsWith('s') ? drag.dy : -drag.dy;

  const ratio = drag.startHeight > 0 ? drag.startWidth / drag.startHeight : null;

  // No ratio to keep — the natural size is not known yet — so the width is the
  // only thing a drag can say, whatever the modifier is doing.
  if (ratio === null) {
    return {
      width: Math.max(MIN_IMAGE_SIZE_PX, Math.round(drag.startWidth + growX)),
      height: null,
    };
  }

  if (drag.freeRatio) {
    return {
      width: Math.max(MIN_IMAGE_SIZE_PX, Math.round(drag.startWidth + growX)),
      height: Math.max(MIN_IMAGE_SIZE_PX, Math.round(drag.startHeight + growY)),
    };
  }

  const driven =
    Math.abs(growX) >= Math.abs(growY)
      ? drag.startWidth + growX
      : (drag.startHeight + growY) * ratio;

  const floor = Math.max(MIN_IMAGE_SIZE_PX, Math.ceil(MIN_IMAGE_SIZE_PX * ratio));
  return { width: Math.max(floor, Math.round(driven)), height: null };
}

/**
 * The size a drag starts from: what the document says, then what the browser
 * loaded, then nothing.
 *
 * A height of `0` is *not known* rather than *zero high*, and `resizedSize`
 * reads it that way — an image whose file has not loaded yet can still be
 * widened, it just cannot keep a ratio nobody knows.
 */
export function startSizeOf(node: ProseMirrorNode, img: HTMLImageElement): DragGeometry {
  const width = typeof node.attrs.width === 'number' ? node.attrs.width : img.naturalWidth;
  const height =
    typeof node.attrs.height === 'number'
      ? node.attrs.height
      : width > 0 && img.naturalWidth > 0
        ? Math.round((width * img.naturalHeight) / img.naturalWidth)
        : img.naturalHeight;
  return { startWidth: width, startHeight: height, corner: 'se', dx: 0, dy: 0, freeRatio: false };
}

/**
 * The width to write onto a picture that drew at nothing, or `null` to leave
 * it alone (#252).
 *
 * ── The defect, and why the answer is a number rather than a rule ──
 *
 * An svg whose root carries only a `viewBox` has a ratio and **no intrinsic
 * width**. The wrapper this node view builds is `display: inline-block`, so
 * its width is shrink-to-fit from its content — and a picture with no
 * intrinsic width contributes nothing, so the wrapper is zero wide and the
 * picture inside it is drawn at zero. Nothing appears.
 *
 * **Four stylesheet candidates were measured in Edge and all four drew zero**:
 * the cap moved onto the wrapper, the wrapper capped as well, the wrapper as
 * an `inline-flex`, and `width: max-content` on the picture. `max-width` is
 * not the cause, which is what those numbers establish — so there is no rule
 * that repairs this without moving every other image, and the repair is a
 * width.
 *
 * ── What it decides on, and why each part is there ──
 *
 * `nodeWidth` — a picture the document gave a size keeps it. `showSize` has
 * already written that width, so there is nothing to rescue.
 *
 * `isSvg` — every other kind carries its own width and never reaches zero
 * for this reason. Restricting the branch is what keeps a png that has simply
 * not been laid out yet from being given a size it never asked for.
 *
 * `naturalWidth` — **zero means the picture has not loaded**, not that it is
 * zero wide, so there is no size to hand out yet and this answers `null`. It
 * is also the value written when the answer is a number: Chromium reports
 * 300 by 150 for an svg with no intrinsic size, which is the default object
 * size from the specification. **AgentEd therefore chooses no size at all** —
 * it writes down the one the runtime already reports, which is why this
 * repair asks nothing of R-C5. Owner decision of 2026-09-07, over a fixed
 * 300, for exactly that reason.
 *
 * `drawnWidth` — the symptom, and the whole reason this is asked after layout
 * rather than from the bytes. An svg spelling its root `width="100%"` carries
 * a width and is still a percentage inside a shrink-to-fit box, so a bytes
 * test would call it sized and leave it at zero. Asking what was drawn cannot
 * be wrong about which pictures need help.
 *
 * **Nothing here reaches a file.** The width is written as inline style on
 * the element, which the serializer never reads — `renderHTML` writes the
 * node attributes, and this changes none of them.
 */
export function fallbackWidthFor(picture: {
  readonly nodeWidth: number | null;
  readonly isSvg: boolean;
  readonly naturalWidth: number;
  readonly drawnWidth: number;
}): number | null {
  if (picture.nodeWidth !== null) return null;
  if (!picture.isSvg) return null;
  if (picture.naturalWidth < 1) return null;
  if (picture.drawnWidth >= 1) return null;
  return picture.naturalWidth;
}

/**
 * Whether the picture behind `displayUrl` is an svg, answered by the same
 * table that decided the media type its blob was given (#251, #252).
 *
 * One table, two consumers, so the kind this node view acts on and the kind
 * the browser was told about cannot drift apart. A picture the registry does
 * not hold — an absolute `http` address, which the loader leaves alone — is
 * not an svg as far as this is concerned, and keeps the behaviour it has.
 */
export function isSvgDisplayUrl(displayUrl: string): boolean {
  const image = getImageByUrl(displayUrl);
  if (image === undefined) return false;
  return displayMimeFromName(image.filename) === 'image/svg+xml';
}

/**
 * Write a size onto one image, as **one** transaction (R-C16).
 *
 * A gesture is one change the user made, so it is one entry in the undo stack
 * — not one per pointer-move, which would put dozens of steps in it and make
 * undo useless for exactly the edit it is most needed for. The preview during
 * the drag is inline style on the element and reaches no transaction at all.
 *
 * `closeHistory` is what makes *one* an actual count rather than an intention:
 * the history plugin appends a change to the previous event when the two are
 * close enough in time, so two quick drags would otherwise collapse into one
 * undo. Closing the event on the way out means the next gesture starts its own.
 *
 * A `null` width and height is the reset, and decision 4 on #27 falls out of it
 * with no branch here: the serializer writes the form the file used, so an
 * image that was markdown is markdown again and one that was HTML stays HTML
 * with the size attributes gone.
 */
export function commitImageSize(view: EditorView, pos: number, size: ImagePixelSize): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'image') return false;
  if (node.attrs.width === size.width && node.attrs.height === size.height) return false;

  const tr = view.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    width: size.width,
    height: size.height,
  });
  view.dispatch(closeHistory(tr));
  return true;
}

/** What TipTap hands a node view renderer, narrowed to what this one uses. */
interface NodeViewProps {
  readonly node: ProseMirrorNode;
  readonly view: EditorView;
  readonly getPos: () => number | undefined;
}

/**
 * The node view: an image, and four handles while it is selected.
 *
 * **`selectNode` and `deselectNode` are deliberately not defined.** A node view
 * that provides them takes over what happens on selection, and what
 * `prosemirror-view` does by default is put `ProseMirror-selectednode` on the
 * view element — which is the class the stylesheet already hangs the outline
 * on, and now the handles too. Defining them meant that class was never
 * written, so the selected image lost the outline it has always had; measured
 * here before it was removed. Leaving the vendor to it keeps one mechanism
 * where there would otherwise be two, and the wrapper is what carries it.
 *
 * The handles are built once and shown by that class rather than added and
 * removed on every selection change, so a pointer already down on one cannot
 * have it taken away underneath.
 */
export function createImageNodeView(props: NodeViewProps): NodeView {
  const { view, getPos } = props;
  let node = props.node;

  const dom = document.createElement('span');
  dom.className = RESIZE_WRAPPER_CLASS;

  const img = document.createElement('img');
  // The bytes are not decoded and the element is not in the layout when the
  // first paint runs, so the rescue below is asked again once both are true
  // (#252). One listener, never removed, because the element and the node
  // view die together.
  img.addEventListener('load', () => rescueZeroWidth());
  dom.appendChild(img);

  const handles = CORNERS.map((corner) => {
    const handle = document.createElement('span');
    handle.className = RESIZE_HANDLE_CLASS;
    handle.setAttribute(CORNER_ATTRIBUTE, corner);
    // Never part of the text: a caret must not be able to land in a handle,
    // and the browser must not offer it as a drag source of its own.
    handle.contentEditable = 'false';
    handle.draggable = false;
    dom.appendChild(handle);
    return handle;
  });

  /** The gesture in progress, or `null` between gestures. */
  let drag: (DragGeometry & { readonly pointerId: number; readonly handle: HTMLElement }) | null =
    null;

  function paint(): void {
    img.setAttribute('src', String(node.attrs.src ?? ''));
    img.setAttribute('alt', String(node.attrs.alt ?? ''));
    if (typeof node.attrs.title === 'string') img.setAttribute('title', node.attrs.title);
    else img.removeAttribute('title');
    showSize({
      width: typeof node.attrs.width === 'number' ? node.attrs.width : null,
      height: typeof node.attrs.height === 'number' ? node.attrs.height : null,
    });
    rescueZeroWidth();
  }

  /**
   * Give a picture that drew at nothing the width the runtime reports (#252).
   *
   * **Called after `showSize` rather than instead of it**, and on every paint,
   * because `showSize` writes the empty string for a picture the document
   * gave no size — so a repaint of an unsized svg would otherwise take the
   * rescue away and collapse it again. Resetting a resized one to its natural
   * size goes through the same path and lands here, which is what makes the
   * reset produce a picture rather than nothing.
   *
   * Also called on `load`, because the first paint happens before the bytes
   * have been decoded and before the element is in the layout: `naturalWidth`
   * is zero then, which `fallbackWidthFor` reads as *not loaded yet* and
   * declines to act on.
   */
  function rescueZeroWidth(): void {
    const width = fallbackWidthFor({
      nodeWidth: typeof node.attrs.width === 'number' ? node.attrs.width : null,
      isSvg: isSvgDisplayUrl(String(node.attrs.src ?? '')),
      naturalWidth: img.naturalWidth,
      drawnWidth: img.getBoundingClientRect().width,
    });
    if (width !== null) img.style.width = `${width}px`;
  }

  /**
   * Show a size, without touching the document.
   *
   * Inline style rather than the `width` attribute, because the stylesheet
   * sets `height: auto` on every image in the editor and an attribute loses to
   * it — so a freed ratio, the one case that carries a height, could not be
   * shown at all. A locked size leaves the height alone deliberately, which is
   * what lets `height: auto` keep the ratio while `max-width: 100%` still caps
   * the picture in a narrow window.
   *
   * None of this reaches the file: the serializer reads `renderHTML`, which
   * writes the node attributes, and never sees this element.
   */
  function showSize(size: ImagePixelSize): void {
    img.style.width = size.width === null ? '' : `${size.width}px`;
    img.style.height = size.height === null ? '' : `${size.height}px`;
  }

  function positionOf(): number | null {
    const pos = getPos();
    return typeof pos === 'number' ? pos : null;
  }

  function onPointerDown(event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    const corner = handle.getAttribute(CORNER_ATTRIBUTE) as Corner | null;
    if (corner === null || drag !== null) return;
    event.preventDefault();
    event.stopPropagation();

    const start = startSizeOf(node, img);
    drag = {
      ...start,
      corner,
      dx: event.clientX,
      dy: event.clientY,
      freeRatio: event.shiftKey,
      pointerId: event.pointerId,
      handle,
    };
    // Guarded rather than assumed: pointer capture keeps a drag that leaves the
    // handle attached to it, and a runtime without it still resizes — the
    // gesture simply ends where the pointer leaves the element.
    if (typeof handle.setPointerCapture === 'function') {
      handle.setPointerCapture(event.pointerId);
    }
  }

  /** The geometry for where the pointer is now. `dx`/`dy` start as the origin. */
  function geometryAt(event: PointerEvent): DragGeometry {
    const started = drag as DragGeometry & { pointerId: number };
    return {
      startWidth: started.startWidth,
      startHeight: started.startHeight,
      corner: started.corner,
      dx: event.clientX - started.dx,
      dy: event.clientY - started.dy,
      // Read every move, so letting the modifier go mid-drag locks the ratio
      // again rather than leaving the gesture in whichever mode it began in.
      freeRatio: event.shiftKey,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    showSize(resizedSize(geometryAt(event)));
  }

  function onPointerUp(event: PointerEvent): void {
    if (drag === null || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const size = resizedSize(geometryAt(event));
    const handle = drag.handle;
    if (
      typeof handle.releasePointerCapture === 'function' &&
      handle.hasPointerCapture?.(event.pointerId)
    ) {
      handle.releasePointerCapture(event.pointerId);
    }
    drag = null;

    const pos = positionOf();
    if (pos === null) {
      // The node has left the document under the gesture. Put the picture back
      // to what the node last said rather than leaving the preview on screen.
      paint();
      return;
    }
    if (!commitImageSize(view, pos, size)) paint();
  }

  /** Double-click on a handle returns the image to its natural size. */
  function onDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const pos = positionOf();
    if (pos === null) return;
    commitImageSize(view, pos, { width: null, height: null });
  }

  for (const handle of handles) {
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
    handle.addEventListener('dblclick', onDoubleClick);
  }

  paint();

  return {
    dom,

    update(updated) {
      if (updated.type.name !== 'image') return false;
      node = updated;
      // A size arriving while a gesture is in flight would fight the preview.
      // The gesture is the newer statement of intent, so it keeps the screen
      // and `onPointerUp` writes the result.
      if (drag === null) paint();
      return true;
    },

    // Every event on a handle is this view's own gesture, and none of it is a
    // document edit ProseMirror should route.
    stopEvent(event) {
      const target = event.target;
      return target instanceof HTMLElement && target.classList.contains(RESIZE_HANDLE_CLASS);
    },

    // This view writes its own DOM — the handles, and the inline size while a
    // drag is in flight. None of it comes from the document, so none of it is
    // a change ProseMirror should read back out of the element.
    ignoreMutation() {
      return true;
    },

    destroy() {
      for (const handle of handles) {
        handle.removeEventListener('pointerdown', onPointerDown);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerUp);
        handle.removeEventListener('dblclick', onDoubleClick);
      }
      drag = null;
    },
  };
}
