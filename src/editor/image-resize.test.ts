/**
 * Dragging an image to a new size (#27).
 *
 * ── What no test here can answer, said first ──
 *
 * Whether the handles land on the corners, whether the outline hugs the
 * picture, whether the drag tracks the pointer — all of it is **layout**.
 * Nothing in this repository renders CSS, and `happy-dom` answers `0` to
 * `offsetWidth`, to `naturalWidth` and to every field of
 * `getBoundingClientRect`. So that half rests on the owner's manual pass on
 * Windows, which is where this feature is verified rather than merely
 * confirmed. `image-resize.ts` carries the same statement beside the code.
 *
 * What is asserted here is everything that is not layout, in three groups:
 *
 *  1. **The arithmetic**, directly, as a pure function.
 *  2. **The DOM joined to the stylesheet.** The selector is read out of
 *     `src/styles.css` — the `#164` shape — and run against the element the
 *     editor actually rendered. Either half alone asserts nothing: a test that
 *     spells the selector again passes with the sheet saying something else,
 *     and a rule reaching nothing is not a failure anyone would see.
 *  3. **The transaction**, which is where R-C16 lives: one gesture, one undo.
 */
import { undoDepth } from '@tiptap/pm/history';
import { afterEach, describe, expect, it } from 'vitest';
import STYLES from '../styles.css?inline';
import { clearImages, registerImage } from './image-registry';
import {
  CORNER_ATTRIBUTE,
  CORNERS,
  type Corner,
  type DragGeometry,
  fallbackWidthFor,
  isSvgDisplayUrl,
  MIN_IMAGE_SIZE_PX,
  RESIZE_HANDLE_CLASS,
  RESIZE_WRAPPER_CLASS,
  releasedSize,
  resizedSize,
  startSizeOf,
} from './image-resize';
import { createEditor, type EditorInstance } from './setup';

/**
 * The class `prosemirror-view` writes on a selected node view, which is what
 * both the outline and the handles hang on. Named here rather than imported,
 * because it is the vendor's and not this repository's to rename.
 */
const SELECTED_NODE_CLASS = 'ProseMirror-selectednode';

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** The position of the one image in the document. */
function imagePosition(editor: EditorInstance): number {
  let found: number | null = null;
  editor.editor.state.doc.descendants((node, pos) => {
    if (found === null && node.type.name === 'image') found = pos;
    return found === null;
  });
  if (found === null) throw new Error('the document holds no image');
  return found;
}

/** Open a document, select its image, and hand back what the editor rendered. */
function withSelectedImage(markdown: string): {
  editor: EditorInstance;
  dom: HTMLElement;
  handles: HTMLElement[];
} {
  const editor = editorWith(markdown);
  editor.editor.commands.setNodeSelection(imagePosition(editor));
  const dom = editor.editor.view.dom as HTMLElement;
  return {
    editor,
    dom,
    handles: Array.from(dom.querySelectorAll<HTMLElement>(`.${RESIZE_HANDLE_CLASS}`)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the arithmetic
// ─────────────────────────────────────────────────────────────────────────────

const SQUARE: DragGeometry = {
  startWidth: 400,
  startHeight: 200,
  corner: 'se',
  dx: 0,
  dy: 0,
  freeRatio: false,
};

describe('the size a drag reaches', () => {
  it('a drag that has not moved changes nothing', () => {
    expect(resizedSize(SQUARE)).toEqual({ width: 400, height: null });
  });

  it.each<[Corner, number, number, number]>([
    // Away from the picture grows it, towards it shrinks it, whichever corner.
    ['se', 100, 0, 500],
    ['se', -100, 0, 300],
    ['ne', 100, 0, 500],
    ['ne', -100, 0, 300],
    ['sw', 100, 0, 300],
    ['sw', -100, 0, 500],
    ['nw', 100, 0, 300],
    ['nw', -100, 0, 500],
  ])('dragging %s by %s horizontally gives width %s', (corner, dx, dy, width) => {
    expect(resizedSize({ ...SQUARE, corner, dx, dy })).toEqual({ width, height: null });
  });

  it.each<[Corner, number, number]>([
    // A vertical drag drives the width through the ratio, which is 2 here. The
    // half that a width-only implementation gets wrong: it would return 400.
    ['se', 100, 600],
    ['ne', 100, 200],
    ['sw', 100, 600],
    ['nw', 100, 200],
  ])('dragging %s down by %s drives the width through the ratio to %s', (corner, dy, width) => {
    expect(resizedSize({ ...SQUARE, corner, dx: 0, dy })).toEqual({ width, height: null });
  });

  it('a locked drag writes one number, because the ratio derives the other', () => {
    expect(resizedSize({ ...SQUARE, dx: 100, dy: 50 }).height).toBeNull();
  });

  it('the modifier frees the ratio and then both numbers are written', () => {
    expect(resizedSize({ ...SQUARE, dx: 100, dy: 50, freeRatio: true })).toEqual({
      width: 500,
      height: 250,
    });
  });

  it('a freed drag can change the shape, which is the whole point of freeing it', () => {
    expect(resizedSize({ ...SQUARE, dx: 100, dy: -50, freeRatio: true })).toEqual({
      width: 500,
      height: 150,
    });
  });

  it('the larger movement drives a locked drag, so neither axis is dead', () => {
    // Horizontal dominant.
    expect(resizedSize({ ...SQUARE, dx: 100, dy: 10 }).width).toBe(500);
    // Vertical dominant: 200 + 100 = 300 high, times the ratio of 2.
    expect(resizedSize({ ...SQUARE, dx: 10, dy: 100 }).width).toBe(600);
  });

  it('an image cannot be shrunk past the minimum', () => {
    const shrunk = resizedSize({ ...SQUARE, dx: -100000, dy: -100000 });
    expect(shrunk.width).toBeGreaterThanOrEqual(MIN_IMAGE_SIZE_PX);
  });

  it('the minimum holds in the dimension that is not written, too', () => {
    // The half a width-only floor gets wrong. This image is 8 times as wide as
    // it is high, so a width at the minimum would be 3 pixels of height. The
    // floor is raised by the ratio so the derived height clears the minimum.
    const wide = { ...SQUARE, startWidth: 800, startHeight: 100, dx: -100000, dy: 0 };
    const shrunk = resizedSize(wide);
    expect(shrunk.width).toBe(MIN_IMAGE_SIZE_PX * 8);
    expect(shrunk.width / 8).toBeGreaterThanOrEqual(MIN_IMAGE_SIZE_PX);
  });

  it('a freed drag clamps each dimension on its own', () => {
    expect(resizedSize({ ...SQUARE, dx: -100000, dy: -100000, freeRatio: true })).toEqual({
      width: MIN_IMAGE_SIZE_PX,
      height: MIN_IMAGE_SIZE_PX,
    });
  });

  it('an image whose natural size is not known yet can still be widened', () => {
    // `startHeight: 0` means *not known*, not *zero high* — an image whose file
    // has not loaded. There is no ratio to keep, so the width is all a drag can
    // say, and the modifier makes no difference.
    const unknown = { ...SQUARE, startHeight: 0, dx: 100, dy: 100 };
    expect(resizedSize(unknown)).toEqual({ width: 500, height: null });
    expect(resizedSize({ ...unknown, freeRatio: true })).toEqual({ width: 500, height: null });
  });

  it('a size is always a whole number of pixels', () => {
    const odd = resizedSize({ ...SQUARE, startWidth: 401, startHeight: 300, dx: 0, dy: 7 });
    expect(Number.isInteger(odd.width)).toBe(true);
  });

  it('a pointer crossing 45 degrees over a 2:1 picture never reverses the drag (#439)', () => {
    // The stutter #439 reported. The pointer climbs a staircase along 45
    // degrees, one pixel at a time, which is how a hand moving diagonally
    // arrives. Climbing down first, it crosses 45 degrees on every other
    // step: against 45 degrees the driving axis flipped each time and the two
    // axes disagree by the ratio, so the width went up by two and back by
    // one, over and over. Against the picture diagonal they agree where they
    // switch. Both orders are walked, so the path crosses in both directions.
    for (const corner of CORNERS) {
      const sx = corner.endsWith('e') ? 1 : -1;
      const sy = corner.startsWith('s') ? 1 : -1;
      for (const downFirst of [true, false]) {
        let previous = resizedSize({ ...SQUARE, corner }).width;
        for (let step = 1; step <= 200; step += 1) {
          const across = downFirst ? Math.floor(step / 2) : Math.ceil(step / 2);
          const down = downFirst ? Math.ceil(step / 2) : Math.floor(step / 2);
          const width = resizedSize({ ...SQUARE, corner, dx: sx * across, dy: sy * down }).width;
          const where = `${corner}, ${downFirst ? 'down' : 'across'} first, step ${step}`;
          expect(width, where).toBeGreaterThanOrEqual(previous);
          expect(width - previous, where).toBeLessThanOrEqual(2);
          previous = width;
        }
      }
    }
  });

  it('on the picture diagonal both axes give the same width, so the switch is invisible', () => {
    // 400 by 200: 100 across and 50 down is on the diagonal, and either axis
    // reaches 500 from there.
    expect(resizedSize({ ...SQUARE, dx: 100, dy: 50 }).width).toBe(500);
    expect(resizedSize({ ...SQUARE, dx: 100, dy: 51 }).width).toBe(502);
    expect(resizedSize({ ...SQUARE, dx: 101, dy: 50 }).width).toBe(501);
  });
});

/** An image element whose layout answers are the ones given, and nothing else stubbed. */
function laidOut(natural: number, naturalHeight: number, drawn: () => number): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'naturalWidth', { value: natural, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: naturalHeight, configurable: true });
  img.getBoundingClientRect = () => {
    const width = drawn();
    return { width, height: (width * naturalHeight) / natural } as DOMRect;
  };
  return img;
}

describe('where a drag starts (#439, 1a)', () => {
  const unsized = { attrs: { width: null, height: null } } as unknown as Parameters<
    typeof startSizeOf
  >[0];

  it('a picture drawn narrower than its own width starts from what was drawn', () => {
    // The 1920 px screenshot of #439, drawn at 720 by the column. Started
    // from 1920, a corner had to travel 1201 px before anything moved.
    const start = startSizeOf(
      unsized,
      laidOut(1920, 1080, () => 720),
    );
    expect(start.startWidth).toBe(720);
    expect(start.startHeight).toBe(405);
  });

  it('a picture narrower than the editor still starts from its own width', () => {
    const start = startSizeOf(
      unsized,
      laidOut(300, 200, () => 300),
    );
    expect(start.startWidth).toBe(300);
    expect(start.startHeight).toBe(200);
  });

  it('a width the document gave is the start when nothing narrower is drawn', () => {
    const sized = { attrs: { width: 600, height: null } } as unknown as typeof unsized;
    expect(
      startSizeOf(
        sized,
        laidOut(1920, 1080, () => 600),
      ).startWidth,
    ).toBe(600);
    expect(
      startSizeOf(
        sized,
        laidOut(1920, 1080, () => 520),
      ).startWidth,
    ).toBe(520);
  });

  it('no layout is not a width of zero, and the start falls back to the node', () => {
    expect(
      startSizeOf(
        unsized,
        laidOut(1920, 1080, () => 0),
      ).startWidth,
    ).toBe(1920);
  });
});

describe('what a release writes (#439, 1b)', () => {
  const drawn = (width: number, height: number) => ({ width, height });

  it('a release that changed nothing on screen writes nothing', () => {
    expect(
      releasedSize({ width: 1720, height: null }, drawn(720, 405), drawn(720, 405)),
    ).toBeNull();
  });

  it('the width written is never wider than the width drawn at the release', () => {
    // The mirror of reading 1, measured on #439: a 300 px picture pulled 600
    // px outwards reached 900 and was drawn at 720.
    expect(releasedSize({ width: 900, height: null }, drawn(300, 200), drawn(720, 480))).toEqual({
      width: 720,
      height: null,
    });
  });

  it('a release inside the column writes the size reached', () => {
    expect(releasedSize({ width: 250, height: null }, drawn(300, 200), drawn(250, 167))).toEqual({
      width: 250,
      height: null,
    });
  });

  it('a freed drag that changed only the height still writes', () => {
    expect(releasedSize({ width: 300, height: 260 }, drawn(300, 200), drawn(300, 260))).toEqual({
      width: 300,
      height: 260,
    });
  });

  it('no layout at either end writes the size reached, as before #439', () => {
    expect(releasedSize({ width: 500, height: null }, drawn(0, 0), drawn(0, 0))).toEqual({
      width: 500,
      height: null,
    });
    expect(releasedSize({ width: 500, height: null }, drawn(300, 200), drawn(0, 0))).toEqual({
      width: 500,
      height: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the DOM, joined to the stylesheet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A rule of `src/styles.css`, found by what it **does** rather than by its
 * text, so renaming or reordering declarations cannot make this test quietly
 * stop looking at the right rule.
 */
function selectorOfRuleDeclaring(within: string, declaration: RegExp, what: string): string {
  // An empty stylesheet is the one way these tests can pass while looking at
  // nothing, so it is refused before anything is matched against it.
  if (STYLES.length === 0) {
    throw new Error(
      'src/styles.css read as an empty string. `css: true` under `test` in vite.config.ts is ' +
        'what makes a stylesheet readable here (#164); without it this test asserts nothing.',
    );
  }
  // Scoped to a selector naming `within`, which is a class the production code
  // exports, so this finds the rule for *this* feature rather than the first
  // rule in the sheet that happens to declare the same thing.
  const rule = STYLES.match(
    new RegExp(`\\n(\\.tiptap [^{}]*?${within}[^{}]*?)\\{[^}]*?${declaration.source}[^}]*?\\}`),
  );
  if (!rule) {
    throw new Error(
      `src/styles.css no longer has a rule ${what} (#27). If it is done some other way now, ` +
        'this test is the wrong shape, not the CSS.',
    );
  }
  return rule[1].trim();
}

describe('the stylesheet reaches the handles the editor renders', () => {
  it('the rule that shows a handle reaches every handle of a selected image, and nothing else', () => {
    const selector = selectorOfRuleDeclaring(
      RESIZE_HANDLE_CLASS,
      /display:\s*block/,
      'showing the resize handles of a selected image',
    );
    const { dom, handles } = withSelectedImage('![x](a.png)');

    expect(handles).toHaveLength(CORNERS.length);

    const reached = Array.from(dom.querySelectorAll(selector));
    // Complete — every handle is shown.
    expect(reached).toEqual(handles);
    // Sound — the rule shows nothing that is not a handle.
    for (const element of reached) {
      expect(element.classList.contains(RESIZE_HANDLE_CLASS)).toBe(true);
    }
  });

  it('the rule that positions a handle reaches all four corners', () => {
    const wrapperSelector = selectorOfRuleDeclaring(
      RESIZE_HANDLE_CLASS,
      /position:\s*absolute/,
      'positioning a resize handle',
    );
    const { dom, handles } = withSelectedImage('![x](a.png)');
    expect(Array.from(dom.querySelectorAll(wrapperSelector))).toEqual(handles);
    expect(handles.map((handle) => handle.getAttribute(CORNER_ATTRIBUTE))).toEqual([...CORNERS]);
  });

  it('every corner the code builds has a rule placing it, and no rule is left over', () => {
    // The pair that goes wrong quietly: a corner added in the code with no
    // rule for it stacks at the top-left, and a rule for a corner nothing
    // builds is dead. Both halves are read out of the sheet.
    // The quoting inside the selector is the formatter's business rather than
    // this test's — `biome` normalises an attribute selector to double quotes —
    // so both are accepted instead of pinning a style rule nothing depends on.
    const placed = Array.from(
      STYLES.matchAll(
        new RegExp(`\\.${RESIZE_HANDLE_CLASS}\\[${CORNER_ATTRIBUTE}=['"]([a-z]+)['"]\\]`, 'g'),
      ),
    ).map((match) => match[1]);
    expect(new Set(placed)).toEqual(new Set(CORNERS));
  });

  it('a selected image is what the outline reaches, through the wrapper the node view builds', () => {
    // The rule was `.tiptap img.ProseMirror-selectednode` before #27 and the
    // node view is what made that stop matching: ProseMirror marks the wrapper
    // now, not the image inside it. Read out of the sheet so a narrowing back
    // to `img` fails here rather than on a screenshot.
    const selector = selectorOfRuleDeclaring(
      SELECTED_NODE_CLASS,
      /outline:\s*2px\s+solid/,
      'giving a selected node an outline',
    );
    const { dom } = withSelectedImage('![x](a.png)');
    const outlined = Array.from(dom.querySelectorAll(selector));
    expect(outlined).toHaveLength(1);
    expect(outlined[0].classList.contains(RESIZE_WRAPPER_CLASS)).toBe(true);
  });

  it('the space around a picture is on the wrapper, not on the picture (#439)', () => {
    // The layout half is measured in Chromium, because happy-dom lays nothing
    // out: with the margin on the picture every handle stood 8 px off its
    // corner. What is asserted here is the other half, joined: which element
    // the rules declaring a margin actually reach, run against the elements
    // the editor rendered.
    const { dom } = withSelectedImage('![x](a.png)');
    const wrapper = dom.querySelector(`.${RESIZE_WRAPPER_CLASS}`) as HTMLElement;
    const picture = wrapper.querySelector('img') as HTMLImageElement;

    const marginRules = Array.from(
      STYLES.matchAll(/\n(\.tiptap [^{}@]*?)\{[^}]*?\bmargin(?:-top|-bottom)?:[^}]*\}/g),
    ).map((match) => match[1].trim());
    expect(marginRules.length).toBeGreaterThan(0);

    const reaching = (element: Element) =>
      marginRules.filter((selector) => {
        try {
          return Array.from(dom.querySelectorAll(selector)).includes(element);
        } catch {
          return false;
        }
      });
    expect(reaching(picture)).toEqual([]);
    expect(reaching(wrapper)).toEqual([
      selectorOfRuleDeclaring(RESIZE_WRAPPER_CLASS, /margin:\s*0\.5em 0/, 'spacing an image'),
    ]);
  });

  it('the outline rule is general, which is the line owed since #212', () => {
    // A horizontal rule clicked as a node had no visible feedback, because the
    // repository took the vendor hide-selection rules without the general
    // selected-node outline beside them. The selector must not name an element.
    const selector = selectorOfRuleDeclaring(
      SELECTED_NODE_CLASS,
      /outline:\s*2px\s+solid/,
      'giving a selected node an outline',
    );
    expect(selector).toBe(`.tiptap .${SELECTED_NODE_CLASS}`);

    const editor = editorWith('---');
    let rulePosition: number | null = null;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule') rulePosition = pos;
      return rulePosition === null;
    });
    expect(rulePosition).not.toBeNull();
    editor.editor.commands.setNodeSelection(rulePosition as unknown as number);
    const reached = (editor.editor.view.dom as HTMLElement).querySelectorAll(selector);
    expect(reached).toHaveLength(1);
    expect(reached[0].nodeName).toBe('HR');
  });
});

describe('the handles appear with the selection and go with it', () => {
  it('an unselected image has no handles shown', () => {
    const editor = editorWith('![x](a.png)');
    const wrapper = (editor.editor.view.dom as HTMLElement).querySelector(
      `.${RESIZE_WRAPPER_CLASS}`,
    );
    expect(wrapper).not.toBeNull();
    expect(wrapper?.classList.contains(SELECTED_NODE_CLASS)).toBe(false);
  });

  it('selecting the image shows them and moving the selection away hides them', () => {
    const { editor, dom } = withSelectedImage('![x](a.png)\n\ntext');
    const wrapper = dom.querySelector(`.${RESIZE_WRAPPER_CLASS}`) as HTMLElement;
    expect(wrapper.classList.contains(SELECTED_NODE_CLASS)).toBe(true);

    editor.editor.commands.setTextSelection(editor.editor.state.doc.content.size - 1);
    expect(wrapper.classList.contains(SELECTED_NODE_CLASS)).toBe(false);
  });

  it('the handles are built once and are not part of the text', () => {
    const { handles } = withSelectedImage('![x](a.png)');
    for (const handle of handles) {
      expect(handle.contentEditable).toBe('false');
      expect(handle.draggable).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — the transaction (R-C16)
// ─────────────────────────────────────────────────────────────────────────────

/** One whole gesture on one handle, as the pointer would deliver it. */
function drag(
  handle: HTMLElement,
  from: readonly [number, number],
  to: readonly [number, number],
  options: { readonly shiftKey?: boolean; readonly steps?: number } = {},
): void {
  const steps = options.steps ?? 4;
  const shiftKey = options.shiftKey ?? false;
  const fire = (type: string, x: number, y: number) => {
    handle.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        clientX: x,
        clientY: y,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  fire('pointerdown', from[0], from[1]);
  for (let step = 1; step <= steps; step += 1) {
    fire(
      'pointermove',
      from[0] + ((to[0] - from[0]) * step) / steps,
      from[1] + ((to[1] - from[1]) * step) / steps,
    );
  }
  fire('pointerup', to[0], to[1]);
}

/** The handle for one corner of the selected image. */
function handleFor(handles: HTMLElement[], corner: Corner): HTMLElement {
  const handle = handles.find((each) => each.getAttribute(CORNER_ATTRIBUTE) === corner);
  if (!handle) throw new Error(`no ${corner} handle`);
  return handle;
}

describe('one gesture is one entry in the undo stack (R-C16)', () => {
  it('a drag of many moves leaves exactly one step behind', () => {
    const { editor, handles } = withSelectedImage('<img src="a.png" alt="x" width="600">');
    const before = undoDepth(editor.editor.state);

    // Twenty moves in one gesture. One per move is the failure this asserts
    // against, and it would leave twenty steps here.
    drag(handleFor(handles, 'se'), [0, 0], [-300, 0], { steps: 20 });

    expect(undoDepth(editor.editor.state) - before).toBe(1);
    expect(editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width).toBe(300);
  });

  it('one undo puts the image back to the size it had', () => {
    const { editor, handles } = withSelectedImage('<img src="a.png" alt="x" width="600">');
    drag(handleFor(handles, 'se'), [0, 0], [-300, 0]);
    expect(editor.getMarkdown().trim()).toBe('<img src="a.png" alt="x" width="300">');

    editor.editor.commands.undo();
    expect(editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width).toBe(600);
    expect(editor.getMarkdown().trim()).toBe('<img src="a.png" alt="x" width="600">');
  });

  it('a second undo does not walk past the document that was loaded', () => {
    // R-C16: undo bottoms out at the document as it was loaded. The first undo
    // takes the resize; the second has nothing of the user own to take.
    const { editor, handles } = withSelectedImage('<img src="a.png" alt="x" width="600">');
    drag(handleFor(handles, 'se'), [0, 0], [-300, 0]);
    editor.editor.commands.undo();
    const after = editor.getMarkdown().trim();
    editor.editor.commands.undo();
    expect(editor.getMarkdown().trim()).toBe(after);
  });

  it('two drags are two separate undos, not one merged event', () => {
    // The history plugin appends a change to the previous event when the two
    // are close enough in time, and these are in the same millisecond. Without
    // `closeHistory` they collapse and one undo takes both gestures.
    const { editor, handles } = withSelectedImage('<img src="a.png" alt="x" width="600">');
    drag(handleFor(handles, 'se'), [0, 0], [-100, 0]);
    drag(handleFor(handles, 'se'), [0, 0], [-100, 0]);
    expect(editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width).toBe(400);

    editor.editor.commands.undo();
    expect(editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width).toBe(500);
    editor.editor.commands.undo();
    expect(editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width).toBe(600);
  });

  it('a gesture that ends where it began writes nothing at all', () => {
    const { editor, handles } = withSelectedImage('<img src="a.png" alt="x" width="600">');
    const before = undoDepth(editor.editor.state);
    drag(handleFor(handles, 'se'), [40, 40], [40, 40]);
    expect(undoDepth(editor.editor.state) - before).toBe(0);
  });
});

/**
 * Give the picture the editor rendered the layout `happy-dom` cannot produce:
 * a natural size, and a drawn width that is what a browser would draw - the
 * preview width the node view wrote, or the natural width, capped by the
 * column as `max-width: 100%` caps it. Only those answers are stubbed; the
 * handlers, the arithmetic and the transaction are the real ones.
 */
function withLayout(dom: HTMLElement, natural: [number, number], column: number): void {
  const img = dom.querySelector(`.${RESIZE_WRAPPER_CLASS} img`) as HTMLImageElement;
  Object.defineProperty(img, 'naturalWidth', { value: natural[0], configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: natural[1], configurable: true });
  img.getBoundingClientRect = () => {
    const wanted = Number.parseFloat(img.style.width) || natural[0];
    const width = Math.min(wanted, column);
    return { width, height: (width * natural[1]) / natural[0] } as DOMRect;
  };
}

describe('a drag measured against what was drawn (#439)', () => {
  it('a picture capped by the column moves from its drawn width', () => {
    // 1a through the node view: 200 px in from 720 drawn is 520. Started from
    // 1920, the same drag reached 1720, was still drawn at 720, and moved
    // nothing on screen.
    const { editor, dom, handles } = withSelectedImage('![x](a.png)');
    withLayout(dom, [1920, 1080], 720);
    drag(handleFor(handles, 'se'), [0, 0], [-200, 0], { steps: 10 });
    expect(editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width).toBe(520);
  });

  it('a drag that showed no change writes nothing to the document and no undo step', () => {
    // Asserted on the document and the undo depth, not on the screen. A pull
    // outwards on a picture already at the column reaches a wider size and
    // is still drawn at 720, so nothing on screen changes.
    const markdown = '![x](a.png)';
    const { editor, dom, handles } = withSelectedImage(markdown);
    withLayout(dom, [1920, 1080], 720);
    const before = undoDepth(editor.editor.state);
    drag(handleFor(handles, 'se'), [0, 0], [100, 0], { steps: 10 });

    expect(undoDepth(editor.editor.state) - before).toBe(0);
    expect(editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width).toBeNull();
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });

  it('an outward drag past the column writes the width drawn, not the width reached', () => {
    // Measured on #439: 300 px pulled 600 px outwards reached 900 and was
    // drawn at 720.
    const { editor, dom, handles } = withSelectedImage('![x](a.png)');
    withLayout(dom, [300, 200], 720);
    drag(handleFor(handles, 'se'), [0, 0], [600, 0], { steps: 10 });
    expect(editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width).toBe(720);
  });

  it('a picture narrower than the column still resizes from its own width', () => {
    const { editor, dom, handles } = withSelectedImage('![x](a.png)');
    withLayout(dom, [300, 200], 720);
    drag(handleFor(handles, 'se'), [0, 0], [-100, 0], { steps: 10 });
    expect(editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width).toBe(200);
  });
});

describe('what a gesture writes into the document', () => {
  it('a resized markdown image becomes inline html with a width in pixels', () => {
    const { editor, handles } = withSelectedImage('![x](a.png)');
    // No natural size in this harness, so the drag starts from nothing known
    // and the width is what the pointer travelled. The shape is the assertion.
    drag(handleFor(handles, 'se'), [0, 0], [300, 0]);
    expect(editor.getMarkdown().trim()).toBe('<img src="a.png" alt="x" width="300">');
  });

  it('a resized html image keeps every other attribute the file gave it', () => {
    const { editor, handles } = withSelectedImage(
      '<img src=a.png alt=x width=600 title="t" style="border:1px">',
    );
    drag(handleFor(handles, 'se'), [0, 0], [-300, 0]);
    expect(editor.getMarkdown().trim()).toBe(
      '<img src=a.png alt=x width=300 title="t" style="border:1px">',
    );
  });

  it('a locked drag writes the width and no height', () => {
    const { editor, handles } = withSelectedImage(
      '<img src="a.png" alt="x" width="400" height="200">',
    );
    drag(handleFor(handles, 'se'), [0, 0], [100, 0]);
    // The height leaves, because the ratio derives it and one number cannot
    // disagree with itself.
    expect(editor.getMarkdown().trim()).toBe('<img src="a.png" alt="x" width="500">');
  });

  it('the modifier frees the ratio and both numbers are written', () => {
    const { editor, handles } = withSelectedImage(
      '<img src="a.png" alt="x" width="400" height="200">',
    );
    drag(handleFor(handles, 'se'), [0, 0], [100, 50], { shiftKey: true });
    expect(editor.getMarkdown().trim()).toBe('<img src="a.png" alt="x" width="500" height="250">');
  });

  it('a resized markdown image carries its title with it (#230)', () => {
    // #229 wrote `alt` into the canonical form and not the title, so a resize
    // was the one gesture that could delete a title from a file. Driven through
    // a real gesture rather than through `imageMarkup`, because the node is
    // where the title has to survive to.
    const { editor, handles } = withSelectedImage('![x](a.png "the title")');
    drag(handleFor(handles, 'se'), [0, 0], [300, 0]);
    expect(editor.getMarkdown().trim()).toBe(
      '<img src="a.png" alt="x" title="the title" width="300">',
    );
  });

  it('a resized markdown image with no title gains no title attribute', () => {
    const { editor, handles } = withSelectedImage('![x](a.png)');
    drag(handleFor(handles, 'se'), [0, 0], [300, 0]);
    const saved = editor.getMarkdown().trim();
    expect(saved).toBe('<img src="a.png" alt="x" width="300">');
    expect(saved).not.toContain('title');
  });

  it('a titled image reset to its natural size is markdown with its title again', () => {
    const { editor, handles } = withSelectedImage('![x](a.png "the title")');
    drag(handleFor(handles, 'se'), [0, 0], [300, 0]);
    handleFor(handles, 'se').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
    );
    expect(editor.getMarkdown().trim()).toBe('![x](a.png "the title")');
  });

  it('an image cannot be dragged away to nothing', () => {
    const { editor, handles } = withSelectedImage('<img src="a.png" alt="x" width="600">');
    drag(handleFor(handles, 'se'), [0, 0], [-100000, 0]);
    const width = editor.editor.state.doc.nodeAt(imagePosition(editor))?.attrs.width as number;
    expect(width).toBeGreaterThanOrEqual(MIN_IMAGE_SIZE_PX);
  });

  it('the images the gesture did not touch are not touched', () => {
    const { editor, handles } = withSelectedImage(
      '![a](a.png)\n\n<img src="b.png" alt="b" width="400">',
    );
    drag(handleFor(handles, 'se'), [0, 0], [250, 0]);
    expect(editor.getMarkdown().trim()).toBe(
      '<img src="a.png" alt="a" width="250">\n\n<img src="b.png" alt="b" width="400">',
    );
  });
});

describe('a way back to the natural size (decision 4 on #27)', () => {
  /** Double-click on a handle, which is the reset gesture. */
  function reset(handle: HTMLElement): void {
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  }

  it('an image the file spelled as markdown is markdown again', () => {
    const { editor, handles } = withSelectedImage('![x](a.png)');
    drag(handleFor(handles, 'se'), [0, 0], [300, 0]);
    expect(editor.getMarkdown().trim()).toBe('<img src="a.png" alt="x" width="300">');

    reset(handleFor(handles, 'se'));
    expect(editor.getMarkdown().trim()).toBe('![x](a.png)');
  });

  it('an image the file spelled as html stays html, with the size gone', () => {
    const { editor, handles } = withSelectedImage('<img src="a.png" alt="x" width="400">');
    reset(handleFor(handles, 'se'));
    expect(editor.getMarkdown().trim()).toBe('<img src="a.png" alt="x">');
  });

  it('a reset is one undo, and it puts the size back', () => {
    const { editor, handles } = withSelectedImage('<img src="a.png" alt="x" width="400">');
    const before = undoDepth(editor.editor.state);
    reset(handleFor(handles, 'se'));
    expect(undoDepth(editor.editor.state) - before).toBe(1);

    editor.editor.commands.undo();
    expect(editor.getMarkdown().trim()).toBe('<img src="a.png" alt="x" width="400">');
  });

  it('resetting an image that has no size writes nothing', () => {
    const { editor, handles } = withSelectedImage('![x](a.png)');
    const before = undoDepth(editor.editor.state);
    reset(handleFor(handles, 'se'));
    expect(undoDepth(editor.editor.state) - before).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — the width a picture that drew at nothing is rescued with (#252)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **The property is layout and this suite cannot see it**, which is why it is
 * said here rather than at the end. `happy-dom` reports `0` for
 * `naturalWidth` and for every field of `getBoundingClientRect`, so a picture
 * drawn at zero and a picture drawn at 300 are the same thing to it. The
 * measurement that decides this change was made in Edge on the owner machine
 * and is recorded on #252; **the manual pass is where it is verified.**
 *
 * What is held here are the halves that are not layout, joined so neither
 * stands alone:
 *
 *  - the decision itself, as a pure function of four numbers, every branch;
 *  - the kind test, over the real registry rather than a double;
 *  - **the wiring**, driven through the node view the editor actually built,
 *    with the two layout values stubbed onto the element — because a pure
 *    function nothing calls is a repair nobody gets;
 *  - **the reason the repair exists**, read out of `styles.css`: the wrapper
 *    is shrink-to-fit, which is what makes a picture with no intrinsic width
 *    collapse. If that ever stops being true, this rescue is answering a
 *    question nobody is asking any more and should be re-measured.
 */
describe('a picture that drew at nothing is given the width the runtime reports (#252)', () => {
  it('an unsized svg that drew at zero is rescued with its natural width', () => {
    expect(
      fallbackWidthFor({ nodeWidth: null, isSvg: true, naturalWidth: 300, drawnWidth: () => 0 }),
    ).toBe(300);
  });

  it.each([
    [
      'the document already gave it a width',
      { nodeWidth: 219, isSvg: true, naturalWidth: 300, drawnWidth: () => 0 },
    ],
    ['it is not an svg', { nodeWidth: null, isSvg: false, naturalWidth: 300, drawnWidth: () => 0 }],
    [
      'it has not loaded yet',
      { nodeWidth: null, isSvg: true, naturalWidth: 0, drawnWidth: () => 0 },
    ],
    [
      'it drew at a size of its own',
      { nodeWidth: null, isSvg: true, naturalWidth: 300, drawnWidth: () => 240 },
    ],
  ])('nothing is written when %s', (_label, picture) => {
    expect(fallbackWidthFor(picture)).toBeNull();
  });

  it.each([
    ['the document gave it a width', { nodeWidth: 219, isSvg: true, naturalWidth: 300 }],
    ['it is not an svg', { nodeWidth: null, isSvg: false, naturalWidth: 300 }],
    ['it has not loaded yet', { nodeWidth: null, isSvg: true, naturalWidth: 0 }],
  ])('the layout is not read when %s (#439)', (_label, picture) => {
    // The debt #439 paid: every image used to pay for a layout read on every
    // paint, two per image as a document loads, although only an unsized svg
    // can ever need the answer.
    let reads = 0;
    const answer = fallbackWidthFor({
      ...picture,
      drawnWidth: () => {
        reads += 1;
        return 0;
      },
    });
    expect(answer).toBeNull();
    expect(reads).toBe(0);
  });

  it('a natural width of zero is not-loaded rather than zero wide', () => {
    // The two are the same number and opposite situations. Reading it as a
    // size would write `width: 0px` onto a picture still being decoded and
    // pin it shut.
    expect(
      fallbackWidthFor({ nodeWidth: null, isSvg: true, naturalWidth: 0, drawnWidth: () => 0 }),
    ).toBeNull();
  });

  it('the kind is answered by the same table that typed the blob', () => {
    clearImages();
    registerImage('blob:an-svg', {
      relativePath: 'assets/logo.svg',
      data: new Uint8Array([1]),
      filename: 'logo.svg',
    });
    registerImage('blob:a-png', {
      relativePath: 'assets/shot.png',
      data: new Uint8Array([1]),
      filename: 'shot.png',
    });

    expect(isSvgDisplayUrl('blob:an-svg')).toBe(true);
    expect(isSvgDisplayUrl('blob:a-png')).toBe(false);
    // An absolute address the loader leaves alone holds no bytes here, so it
    // is not rescued and keeps the behaviour it has. Stated as a limit.
    expect(isSvgDisplayUrl('https://example.com/logo.svg')).toBe(false);
    clearImages();
  });

  it('the node view asks after the picture loads, on the element the editor rendered', () => {
    // The two values this suite cannot produce are stubbed onto the element,
    // and nothing else is: the call, the decision and the write are the real
    // ones. Without the `load` listener in the node view this goes red.
    clearImages();
    registerImage('blob:rescue-me', {
      relativePath: 'assets/logo.svg',
      data: new Uint8Array([1]),
      filename: 'logo.svg',
    });

    const editor = editorWith('![x](blob:rescue-me)');
    const dom = editor.editor.view.dom as HTMLElement;
    // The picture inside the node view, not the first image in the editor:
    // since prosemirror-view 1.42.6 a hidden `img.ProseMirror-separator`
    // stands before an atom that opens a paragraph (#519).
    const img = dom.querySelector(`.${RESIZE_WRAPPER_CLASS} img`) as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.style.width).toBe('');

    Object.defineProperty(img, 'naturalWidth', { value: 300, configurable: true });
    img.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    img.dispatchEvent(new Event('load'));

    expect(img.style.width).toBe('300px');
    clearImages();
  });

  it('and it survives a repaint, because showSize would otherwise take it away', () => {
    // `showSize` writes the empty string for a picture the document gave no
    // size, so every repaint undoes the rescue unless the rescue runs after
    // it. Without the call in `paint` this row goes red and the picture
    // collapses again the moment anything about the node changes — which
    // includes the reset gesture, whose whole point is a picture rather than
    // nothing.
    clearImages();
    registerImage('blob:repaint-me', {
      relativePath: 'assets/logo.svg',
      data: new Uint8Array([1]),
      filename: 'logo.svg',
    });

    const editor = editorWith('![x](blob:repaint-me)');
    const img = (editor.editor.view.dom as HTMLElement).querySelector(
      `.${RESIZE_WRAPPER_CLASS} img`,
    ) as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 300, configurable: true });
    img.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    img.dispatchEvent(new Event('load'));
    expect(img.style.width).toBe('300px');

    editor.editor.commands.setNodeSelection(imagePosition(editor));
    editor.editor.commands.updateAttributes('image', { alt: 'changed' });

    expect(img.style.width).toBe('300px');
    clearImages();
  });

  it('the load listener goes with the node view (#439)', () => {
    // The one listener `destroy` did not remove. Once the view is gone a late
    // `load` must not reach the rescue and write onto an element nobody owns.
    clearImages();
    registerImage('blob:late-load', {
      relativePath: 'assets/logo.svg',
      data: new Uint8Array([1]),
      filename: 'logo.svg',
    });
    const editor = editorWith('![x](blob:late-load)');
    const img = (editor.editor.view.dom as HTMLElement).querySelector(
      `.${RESIZE_WRAPPER_CLASS} img`,
    ) as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 300, configurable: true });
    img.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;

    editor.destroy();
    instance = null;
    img.dispatchEvent(new Event('load'));

    expect(img.style.width).toBe('');
    clearImages();
  });

  it('a png that drew at nothing is left alone by the same route', () => {
    // The other side of the branch, driven the same way: the kind is what
    // keeps a picture that has simply not been laid out yet from being given
    // a size it never asked for.
    clearImages();
    registerImage('blob:leave-me', {
      relativePath: 'assets/shot.png',
      data: new Uint8Array([1]),
      filename: 'shot.png',
    });

    const editor = editorWith('![x](blob:leave-me)');
    const img = (editor.editor.view.dom as HTMLElement).querySelector(
      `.${RESIZE_WRAPPER_CLASS} img`,
    ) as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 300, configurable: true });
    img.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    img.dispatchEvent(new Event('load'));

    expect(img.style.width).toBe('');
    clearImages();
  });

  it('the wrapper the editor renders is the shrink-to-fit box this rescue exists for', () => {
    // The selector is read out of the stylesheet by what it declares, then
    // run against the element the editor actually built. Either half alone
    // asserts nothing, and together they say the precondition still holds:
    // an inline-block wrapper takes its width from its content, which is what
    // a picture with no intrinsic width cannot supply.
    const selector = selectorOfRuleDeclaring(
      RESIZE_WRAPPER_CLASS,
      /display:\s*inline-block/,
      'making the image wrapper shrink to fit its picture',
    );
    const { dom } = withSelectedImage('![x](a.png)');
    const reached = Array.from(dom.querySelectorAll(selector));

    expect(reached).toHaveLength(1);
    expect(reached[0].classList.contains(RESIZE_WRAPPER_CLASS)).toBe(true);
  });
});
