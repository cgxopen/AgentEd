import type { Editor } from '@tiptap/core';
import { insertCodeBlock } from '../editor/insert-code-block';

export interface ToolbarHandlers {
  /** Open the link dialog (#25). Owned by the app layer, which has the DOM. */
  onLink: () => void;
}

export interface ToolbarButton {
  label: string;
  title: string;
  action: (editor: Editor, handlers: ToolbarHandlers) => void;
  isActive: (editor: Editor) => boolean;
}

const buttons: ToolbarButton[] = [
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
    label: 'H1',
    title: 'Heading 1',
    action: (e) => {
      e.chain().focus().toggleHeading({ level: 1 }).run();
    },
    isActive: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    label: 'H2',
    title: 'Heading 2',
    action: (e) => {
      e.chain().focus().toggleHeading({ level: 2 }).run();
    },
    isActive: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    label: 'H3',
    title: 'Heading 3',
    action: (e) => {
      e.chain().focus().toggleHeading({ level: 3 }).run();
    },
    isActive: (e) => e.isActive('heading', { level: 3 }),
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
export const shippedButtons: ReadonlyArray<ToolbarButton> = buttons;

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
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      btn.action(editor, handlers);
    });
    toolbar.appendChild(el);
    elements.push(el);
  }
  return elements;
}

function bindToolbarEvents(
  toolbar: HTMLElement,
  editor: Editor,
  btnElements: HTMLButtonElement[],
): void {
  function updateActiveStates() {
    for (let i = 0; i < buttons.length; i++) {
      btnElements[i].classList.toggle('active', buttons[i].isActive(editor));
    }
  }

  function positionToolbar() {
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
    const centerX = (start.left + end.right) / 2;
    let left = centerX - rect.width / 2;
    const top = start.top - rect.height - 8;

    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${Math.max(8, top)}px`;
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
