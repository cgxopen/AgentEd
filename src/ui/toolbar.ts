import type { Editor } from '@tiptap/core';

interface ToolbarButton {
  label: string;
  title: string;
  action: (editor: Editor) => void;
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
    label: '<>',
    title: 'Code (Ctrl+E)',
    action: (e) => {
      e.chain().focus().toggleCode().run();
    },
    isActive: (e) => e.isActive('code'),
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

function createToolbarButtons(toolbar: HTMLElement, editor: Editor): HTMLButtonElement[] {
  const elements: HTMLButtonElement[] = [];
  for (const btn of buttons) {
    const el = document.createElement('button');
    el.textContent = btn.label;
    el.title = btn.title;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      btn.action(editor);
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
    const rect = toolbar.getBoundingClientRect();
    const centerX = (start.left + end.right) / 2;
    let left = centerX - rect.width / 2;
    const top = start.top - rect.height - 8;

    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${Math.max(8, top)}px`;
    toolbar.classList.remove('hidden');
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

export function setupToolbar(editor: Editor): void {
  const toolbar = document.createElement('div');
  toolbar.id = 'floating-toolbar';
  toolbar.className = 'floating-toolbar hidden';
  document.body.appendChild(toolbar);

  const btnElements = createToolbarButtons(toolbar, editor);
  bindToolbarEvents(toolbar, editor, btnElements);
}
