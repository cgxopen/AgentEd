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
import {
  CORNER_ATTRIBUTE,
  CORNERS,
  type Corner,
  type DragGeometry,
  MIN_IMAGE_SIZE_PX,
  RESIZE_HANDLE_CLASS,
  RESIZE_WRAPPER_CLASS,
  resizedSize,
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
