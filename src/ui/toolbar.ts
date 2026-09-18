import type { Editor } from '@tiptap/core';
import { AllSelection } from '@tiptap/pm/state';
import { hasImageSelected } from '../editor/image-description';
import { toggleCodeBlock } from '../editor/insert-code-block';
import { editorRoom, withinRoom } from './editor-room';
import {
  activeHeadingLevels,
  closeHeadingLevels,
  HEADING_CHOICES,
  type HeadingChoice,
  openHeadingLevels,
} from './heading-levels';
import { toolbarTop } from './toolbar-placement';

/** Between the toolbar and each end of the room it is placed in (#350). */
const TOOLBAR_MARGIN = 8;

export interface ToolbarHandlers {
  /** Open the link dialog (#25). Owned by the app layer, which has the DOM. */
  onLink: () => void;
  /** Open the image description dialog (#291), the same way. */
  onImageDescription: () => void;
}

/**
 * An entry that runs a command when it is pressed. Eleven of the twelve.
 *
 * Counted in `shippedButtons` at this head: B, I, U, S, the link, inline code,
 * the fenced block, the heading control, the bullet list, the ordered list,
 * the quote and the image description. Eleven carry an action; the heading
 * control is the other shape below. **Twelve entries and eleven drawn at a
 * time**: the image description is drawn only with an image selected, which is
 * the rule below, so a text selection still meets the eleven this comment
 * counted before #291 — measured on the built page, 338.66 px of bar on a
 * text selection and 372.66 on an image.
 *
 * The figure before that one said twelve of thirteen and had been stale for
 * long enough that nobody could say since when, which is why it is counted
 * here rather than carried.
 */
export interface ToolbarButton {
  readonly kind?: 'action';
  label: string;
  title: string;
  action: (editor: Editor, handlers: ToolbarHandlers) => void;
  isActive: (editor: Editor) => boolean;
  /**
   * The drawn symbol this control carries instead of a label (#291). The bar
   * is where the room is tightest and every other control is one or two
   * characters, so a control whose name is a word is drawn rather than
   * written — the shape #330 and #332 gave the header buttons. `label` stays
   * the empty string for such a control, and `title` is where its name is
   * read.
   */
  icon?: () => SVGSVGElement;
  /**
   * The selections this control is offered for, or absent for the ten that
   * are offered for every one (#291). A control that means something only on
   * an image is **not drawn at all** on a text selection, rather than drawn
   * inert: owner decision of 2026-09-17, taken against a bar 34 px wider for
   * every selection in a session.
   */
  appliesTo?: (editor: Editor) => boolean;
}

/**
 * The entry that opens a list instead of running a command (#267).
 *
 * ── Why this is in the same array rather than beside it ──
 *
 * `shippedButtons` is exported so the tests read what ships rather than a copy
 * of it — the #204 lesson. A control built beside the array would leave that
 * exported table no longer describing everything on the toolbar, quietly, and
 * for the newest control. So the type is widened instead, and the cost is paid
 * where it belongs: an entry that opens a list has no command to run, so it
 * carries no `action`, and a caller reaching for one narrows first.
 *
 * `label` is what it reads at rest; `labelFor` is what it reads with the caret
 * inside a heading. Measured on `74cce43`: `H1` through `H6` are 35.94 px each,
 * so switching between levels does not move the toolbar at all — the width is
 * 338.59 px for all six. The stylesheet gives this control a `min-width`, which
 * measured the toolbar at an identical 338.66 px for every label of one or two
 * characters, so the label changing between a heading and body text does not
 * move it either.
 */
export interface ToolbarLevels {
  readonly kind: 'levels';
  label: string;
  title: string;
  labelFor: (editor: Editor) => string;
  isActive: (editor: Editor) => boolean;
  choices: ReadonlyArray<HeadingChoice>;
  choose: (editor: Editor, choice: HeadingChoice) => void;
  levelAt: (editor: Editor) => HeadingChoice['level'];
}

/** Everything the toolbar ships, of either shape. */
export type ToolbarEntry = ToolbarButton | ToolbarLevels;

/** Whether an entry runs a command directly, for a caller that needs one. */
export function isActionEntry(entry: ToolbarEntry): entry is ToolbarButton {
  return entry.kind !== 'levels';
}

/** The heading level the caret sits in, or `null` in ordinary text. */
function headingLevelAt(editor: Editor): HeadingChoice['level'] {
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (editor.isActive('heading', { level })) return level;
  }
  return null;
}

/**
 * The symbol on the image description button: a frame with a horizon inside
 * it, in `currentColor` so it takes the palette the bar already carries.
 *
 * Built rather than written as markup: nothing in this application assigns
 * `innerHTML`, and a drawn symbol is no reason to start. The header does the
 * same picture in `index.html`, where it is markup rather than a string.
 */
function imageSymbol(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('aria-hidden', 'true');
  const frame = document.createElementNS(NS, 'rect');
  frame.setAttribute('x', '1.5');
  frame.setAttribute('y', '3');
  frame.setAttribute('width', '13');
  frame.setAttribute('height', '10');
  frame.setAttribute('rx', '1.5');
  const horizon = document.createElementNS(NS, 'path');
  horizon.setAttribute('d', 'M3 11l3.5-3.5 2.5 2.5 2-2L13 11');
  svg.append(frame, horizon);
  return svg;
}

const buttons: ToolbarEntry[] = [
  {
    label: 'B',
    title: 'Bold (Ctrl+B)',
    action: (e) => {
      e.chain().focus().toggleBold().run();
    },
    isActive: (e) => e.isActive('bold'),
  },
  {
    label: 'I',
    title: 'Italic (Ctrl+I)',
    action: (e) => {
      e.chain().focus().toggleItalic().run();
    },
    isActive: (e) => e.isActive('italic'),
  },
  {
    label: 'U',
    title: 'Underline (Ctrl+U)',
    action: (e) => {
      e.chain().focus().toggleUnderline().run();
    },
    isActive: (e) => e.isActive('underline'),
  },
  {
    label: 'S',
    title: 'Strikethrough',
    action: (e) => {
      e.chain().focus().toggleStrike().run();
    },
    isActive: (e) => e.isActive('strike'),
  },
  {
    // Links are made here or with Ctrl+K — the editor never invents one (#37).
    label: '\u{1F517}',
    title: 'Link (Ctrl+K)',
    action: (_e, handlers) => {
      handlers.onLink();
    },
    isActive: (e) => e.isActive('link'),
  },
  {
    // The two code buttons sit together and are told apart by both halves of
    // what a user reads: the label and the tooltip (#204). This one used to be
    // titled just `Code`, which is the whole of how a missing feature became a
    // wrong turn — the owner went looking for a code block, found the button
    // labelled for code, and got an inline span.
    label: '<>',
    title: 'Inline code (Ctrl+E)',
    action: (e) => {
      e.chain().focus().toggleCode().run();
    },
    isActive: (e) => e.isActive('code'),
  },
  {
    // Labelled with the syntax it writes, the way `1.` is for the ordered
    // list: in a markdown editor the marker is the clearest icon there is, and
    // it teaches the input rule at the same time.
    //
    // **This button is not the whole repair.** The floating toolbar hides
    // itself whenever the selection is empty, so it cannot be reached from the
    // caret the user starts a new block with — that route is the Edit menu and
    // the shortcut, and without them this issue would still be open.
    label: '```',
    title: 'Code block (Ctrl+Shift+K)',
    // The button toggles, and says so by lighting up inside a fence (#279).
    action: toggleCodeBlock,
    isActive: (e) => e.isActive('codeBlock'),
  },
  {
    // One control for six levels (#267). It used to be three buttons for three,
    // while the schema has held 1 to 6 since #263 and nothing on screen said so
    // — the tooltips named no chord either. The list behind this is the route
    // that says the levels go further.
    //
    // **It does not reach an empty caret, and that is unchanged rather than
    // repaired here.** `positionToolbar` hides the toolbar whenever the
    // selection is empty, so a heading is still started from `Ctrl+Alt+1` to
    // `Ctrl+Alt+6` or from the menu. Recorded on the issue as a surface limit.
    kind: 'levels',
    label: 'H',
    title: 'Heading level',
    labelFor: (e) => {
      const level = headingLevelAt(e);
      return level === null ? 'H' : `H${level}`;
    },
    isActive: (e) => e.isActive('heading'),
    choices: HEADING_CHOICES,
    levelAt: headingLevelAt,
    choose: (e, choice) => {
      // `setHeading` rather than `toggleHeading`: choosing the level a heading
      // already has must leave it that heading, where a toggle would turn it
      // into a paragraph. The chords keep toggling, which is what a chord is
      // for.
      if (choice.level === null) {
        e.chain().focus().setParagraph().run();
        return;
      }
      e.chain().focus().setHeading({ level: choice.level }).run();
    },
  },
  {
    label: '\u2022',
    title: 'Bullet list',
    action: (e) => {
      e.chain().focus().toggleBulletList().run();
    },
    isActive: (e) => e.isActive('bulletList'),
  },
  {
    label: '1.',
    title: 'Ordered list',
    action: (e) => {
      e.chain().focus().toggleOrderedList().run();
    },
    isActive: (e) => e.isActive('orderedList'),
  },
  {
    label: '\u201C',
    title: 'Blockquote',
    action: (e) => {
      e.chain().focus().toggleBlockquote().run();
    },
    isActive: (e) => e.isActive('blockquote'),
  },
  {
    // The twelfth control, and the first the bar offers for one kind of
    // selection only (#291). Its name is read in the tooltip, in the menu
    // entry and in the title of the dialog it opens — the three places a
    // person reads words — and the button itself carries the symbol above.
    label: '',
    title: 'Image description',
    icon: imageSymbol,
    appliesTo: (e) => hasImageSelected(e),
    action: (_e, handlers) => {
      handlers.onImageDescription();
    },
    isActive: () => false,
  },
];

/**
 * What the shipped toolbar renders, exported so a test can read the labels and
 * tooltips rather than restating them (#204) — the `ci.test.ts` shape. It is
 * the same array the buttons are built from, not a copy: a copy is how a test
 * goes on passing against a string nothing renders.
 */
export const shippedButtons: ReadonlyArray<ToolbarEntry> = buttons;

function createToolbarButtons(
  toolbar: HTMLElement,
  editor: Editor,
  handlers: ToolbarHandlers,
): HTMLButtonElement[] {
  const elements: HTMLButtonElement[] = [];
  for (const btn of buttons) {
    const el = document.createElement('button');
    if (isActionEntry(btn) && btn.icon) el.appendChild(btn.icon());
    else el.textContent = btn.label;
    el.title = btn.title;
    // The class the stylesheet gives a steady width, so a label that follows
    // the caret does not move the toolbar under the pointer.
    if (!isActionEntry(btn)) el.classList.add('heading-levels-trigger');
    // Every entry keeps the selection alive across the press. Without this the
    // click blurs the editor and the thing the control acts on is gone.
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (isActionEntry(btn)) {
        btn.action(editor, handlers);
        return;
      }
      openLevels(btn, el, toolbar, editor);
    });
    toolbar.appendChild(el);
    elements.push(el);
  }
  return elements;
}

/**
 * Open the level list, or shut it if this press was on an already-open one.
 *
 * The toggle is read from the module that owns the list rather than from a
 * flag here, so a list closed by Escape or by a click elsewhere leaves nothing
 * behind for the next press to disagree with.
 */
function openLevels(
  entry: ToolbarLevels,
  anchor: HTMLElement,
  toolbar: HTMLElement,
  editor: Editor,
): void {
  if (activeHeadingLevels() !== null) {
    closeHeadingLevels();
    return;
  }
  openHeadingLevels({
    anchor,
    toolbar,
    current: entry.levelAt(editor),
    onChoose: (choice) => entry.choose(editor, choice),
  });
}

function bindToolbarEvents(
  toolbar: HTMLElement,
  editor: Editor,
  btnElements: HTMLButtonElement[],
): void {
  /**
   * Which controls this selection is offered (#291). Ten of the twelve are
   * offered for every selection and carry no rule; the image description is
   * drawn only for an image.
   *
   * **It runs before the bar is measured, and that order is the repair of
   * #265 applied to a second cause.** A hidden control changes the width of
   * the bar — 338.66 px on a text selection against 372.66 on an image,
   * measured on the built page — and `positionToolbar` centres the bar on
   * what is selected from a rectangle it takes once. Toggling after that
   * measurement would centre every image selection against the width of the
   * bar it no longer has.
   */
  function updateVisibleControls() {
    for (let i = 0; i < buttons.length; i++) {
      const entry = buttons[i];
      if (!isActionEntry(entry) || !entry.appliesTo) continue;
      btnElements[i].hidden = !entry.appliesTo(editor);
    }
  }

  function updateActiveStates() {
    for (let i = 0; i < buttons.length; i++) {
      const entry = buttons[i];
      btnElements[i].classList.toggle('active', entry.isActive(editor));
      // The one control that says which level is active says it in its label
      // (#267), so the label is refreshed wherever the active states are.
      if (!isActionEntry(entry)) btnElements[i].textContent = entry.labelFor(editor);
    }
  }

  function positionToolbar() {
    // The list acts on the selection that was standing when it opened, so any
    // event that moves the selection ends it (#267). This also covers the two
    // routes the list cannot see for itself: a keystroke that moves the caret
    // while it is open, and the toolbar hiding under it at an empty selection.
    closeHeadingLevels();

    const { selection } = editor.state;
    const { from, to, empty } = selection;
    if (empty || from === to) {
      toolbar.classList.add('hidden');
      return;
    }

    // ── Nothing to offer on a whole-document selection (#336) ──
    //
    // Owner decision of 2026-09-16: the bar carried eleven controls and none of
    // them had an evident use applied to a whole document, so it is not shown
    // for one. The twelfth, added by #291, is drawn for an image alone and so
    // has none there either — a whole-document selection is not a node. Before this it was shown and could not be reached — the
    // placement put it 40.0 px below the window, measured at both window sizes
    // and at every scroll position.
    //
    // **It keys on the selection type, and the owner chose that over the wider
    // rule.** `Ctrl+A` and the Select All entry both produce an `AllSelection`;
    // a drag or a Shift+arrow across every word produces a `TextSelection`,
    // which keeps its bar — someone who dragged deliberately may well be about
    // to press one of the controls it draws, and the band now keeps that bar on
    // screen.
    //
    // Measured rather than reasoned, on two documents — one opening with a
    // paragraph, one opening with a table and ending with a fenced block:
    // `Ctrl+A` and the entry gave `AllSelection` 0..size on both, a drag over
    // every word gave `TextSelection` 1..34 and 4..48. **And the alternative
    // key the issue offered is the same test**: asked for `from: 0, to: size`
    // on four document shapes, ProseMirror clamped every one into the nearest
    // textblock, so a `TextSelection` can never reach position 0 or the
    // document size. Reading the type says what reading the range would.
    if (selection instanceof AllSelection) {
      toolbar.classList.add('hidden');
      return;
    }

    // ── Each end of the selection is asked for its own side (#350, owner pass) ──
    //
    // `coordsAtPos` returns a flat cursor rectangle, and where a position sits
    // between two things that are not adjacent — which is exactly a **soft line
    // wrap** — `side` picks which of them answers. The default is 1, the thing
    // *after* the position, so a selection ending on the space at a wrap used to
    // report its end as **the start of the next line**. The bar was then centred
    // on the midpoint between two points on different lines, which describes
    // nothing.
    //
    // Found by the owner in the #350 manual pass and not by any row here, and
    // the gesture matters: a double-click never reaches it, because it ends the
    // selection inside the word. What reaches it is the ordinary way to take the
    // last word on a line — drag across it and release past its right edge,
    // which takes the trailing space with it. Instrumented in Chromium at
    // 1024x768 on the selection `"sigma "`, drawn at 794.2 to 847.6: the end
    // resolved to **152.0**, the start of the line below, and the bar landed at
    // 303.8 rather than over the text. With the sides below it resolves to
    // 847.5, and the bar centres on the selection.
    //
    // **What this moves, measured over both builds rather than argued**: 491
    // placements across two window sizes, both panel states and both gestures —
    // **485 identical, 6 moved**, every one of them the drag gesture at a wrap
    // and every one of them from a wrong place to the right one. The regression
    // half of #350 is amended for exactly those six, on the owner decision of
    // 2026-09-18 to repair this here rather than after the merge.
    //
    // The vertical placement reads the same two values. `end.bottom` feeds the
    // below-the-selection branch of `toolbarTop`, so that branch used to measure
    // from the line below; `start.top` feeds the above branch, which is why the
    // bar still looked right vertically in the states the owner photographed.
    const start = editor.view.coordsAtPos(from, 1);
    const end = editor.view.coordsAtPos(to, -1);

    // ── The reveal comes before the measurement, and the order is the repair ──
    //
    // `.floating-toolbar.hidden` is `display: none`, and an element with no box
    // answers 0 for both width and height. Measuring first therefore put the
    // toolbar's **left edge** where its centre belonged and its **top** 8 px
    // above the selection rather than 8 px above minus its own height — drawn
    // over the very text it acts on, on every hidden-to-visible transition
    // (#265). A drag hid it, because its second `selectionUpdate` measured a
    // real box and overwrote the first result.
    //
    // Instrumented on Chrome for Testing 153 before the change: 0 by 0 while
    // hidden, 414.47 by 31.59 once revealed. Both call sites — `selectionUpdate`
    // and `focus` — reached this line with the toolbar hidden.
    //
    // The reveal, the measurement and the two assignments below are one
    // synchronous block, so there is no point between them at which the browser
    // could paint; `getBoundingClientRect` forces a reflow, which is not a
    // paint. That is an argument from the rendering model rather than a
    // measurement, and WebView2 is not Chromium — a flash on the first reveal
    // of a session is what the manual pass watches for.
    // Before the reveal and so before the measurement: see the note above.
    updateVisibleControls();
    toolbar.classList.remove('hidden');
    const rect = toolbar.getBoundingClientRect();

    // The header bottom is read here, on every placement, rather than written
    // down (#268). It is content-driven — `#menubar` declares no height — so it
    // computes to 44 px at 100 per cent scaling and to 54, 64 and 87 at 125,
    // 150 and 200. Measured cost beside the toolbar rect already taken on the
    // line above: 0.54 microseconds per call, over 20 000 calls, and no reflow
    // of its own, that rect having already forced one.
    //
    // `#menubar` is written in `index.html`. If it is ever absent this falls
    // back to 0, which gives the window top as the floor — the behaviour before
    // this change rather than a guard against it.
    const header = document.getElementById('menubar');
    const headerBottom = header === null ? 0 : header.getBoundingClientRect().bottom;

    // The room is read here, on every placement, for the same reason the header
    // bottom is read on the line above: it is not a constant this application
    // may write down. Until #347 it was the window, and since the files panel
    // takes its own room beside the editor it is not — measured on `3ff4d55`,
    // the bar was drawn 102.4 px over the panel card at 1024x768 and 108.5 at
    // 150 per cent scaling. With the panel closed `editorRoom` answers the
    // window, so nothing about the placement without it moves.
    const centerX = (start.left + end.right) / 2;
    const left = withinRoom(centerX - rect.width / 2, rect.width, editorRoom(), TOOLBAR_MARGIN);
    toolbar.style.left = `${left}px`;
    // The window height is read here for the same reason the header bottom is,
    // on the line above: it is not a constant this application may write down.
    // It is what bounds the band the bar is kept inside (#336).
    toolbar.style.top = `${toolbarTop(start.top, end.bottom, rect.height, headerBottom, window.innerHeight)}px`;
    updateActiveStates();
  }

  editor.on('selectionUpdate', positionToolbar);
  editor.on('blur', () => {
    setTimeout(() => {
      if (!toolbar.matches(':hover')) {
        toolbar.classList.add('hidden');
      }
    }, 150);
  });
  editor.on('focus', positionToolbar);
}

export function setupToolbar(editor: Editor, handlers: ToolbarHandlers): void {
  const toolbar = document.createElement('div');
  toolbar.id = 'floating-toolbar';
  toolbar.className = 'floating-toolbar hidden';
  document.body.appendChild(toolbar);

  const btnElements = createToolbarButtons(toolbar, editor, handlers);
  bindToolbarEvents(toolbar, editor, btnElements);
}
