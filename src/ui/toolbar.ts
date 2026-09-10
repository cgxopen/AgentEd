import type { Editor } from '@tiptap/core';
import { insertCodeBlock } from '../editor/insert-code-block';
import {
  activeHeadingLevels,
  closeHeadingLevels,
  HEADING_CHOICES,
  type HeadingChoice,
  openHeadingLevels,
} from './heading-levels';
import { toolbarTop } from './toolbar-placement';

export interface ToolbarHandlers {
  /** Open the link dialog (#25). Owned by the app layer, which has the DOM. */
  onLink: () => void;
}

/**
 * An entry that runs a command when it is pressed. Twelve of the thirteen.
 */
export interface ToolbarButton {
  readonly kind?: 'action';
  label: string;
  title: string;
  action: (editor: Editor, handlers: ToolbarHandlers) => void;
  isActive: (editor: Editor) => boolean;
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
    action: insertCodeBlock,
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
    el.textContent = btn.label;
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

    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      toolbar.classList.add('hidden');
      return;
    }

    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);

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

    const centerX = (start.left + end.right) / 2;
    let left = centerX - rect.width / 2;

    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${toolbarTop(start.top, end.bottom, rect.height, headerBottom)}px`;
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
