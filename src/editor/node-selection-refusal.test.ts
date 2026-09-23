import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { isActionEntry, shippedButtons } from '../ui/toolbar';
import { codeBlockAvailability, codeBlockRoutes, INSERT_CODE_BLOCK_KEY } from './insert-code-block';
import { createEditor, type EditorInstance } from './setup';

/**
 * Issue #427 — inline code and the fenced block refuse a node selection, so a
 * selected image survives every route to them.
 *
 * ── What it was, measured on `8934c82` ──
 *
 * With an image selected, **inline code wrote the image markdown as literal
 * text** inside a code span - the picture gone, `` `![Holiday Photo.png](assets/Holiday-Photo.png)` ``
 * left where it had been - and **the fenced block left an empty fence**. Undo
 * restored both, and nothing reached the disk before a save, but a formatting
 * button took the picture off the screen.
 *
 * **The step zero is why the repair is here and not on the toolbar.** Each of
 * the two is reachable without the bar: `Ctrl+E` is TipTap's own binding on the
 * `Code` mark, `Ctrl+Shift+K` is a global shortcut in `app/keyboard.ts`, and
 * `Edit` then `Insert Code Block` is a menu entry. Hiding the two buttons would
 * have left all three working, with no visible control left to connect the
 * damage to. So the commands refuse, and the buttons are then left out as
 * agreement rather than as the repair.
 *
 * ── The wide half, and it is half the file ──
 *
 * A refusal that also refused ordinary text would be a worse defect than the
 * one it repairs, and nothing above would notice. So every row that asserts a
 * refusal has a partner asserting the same route still works on a text
 * selection, by the same call.
 */

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

const WITH_IMAGE = 'One two three.\n\n![Holiday Photo.png](assets/Holiday-Photo.png)\n\nAfter.';
const WITH_RULE = 'Above.\n\n---\n\nBelow.';
const PLAIN = 'One two three.';

function open(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** Select the first node of `type`, which is what a click on one does. */
function selectNode(editor: EditorInstance, type: string): void {
  let at = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.type.name === type) at = pos;
    return at === -1;
  });
  if (at === -1) throw new Error(`the document holds no ${type}`);
  editor.editor.view.dispatch(
    editor.editor.state.tr.setSelection(NodeSelection.create(editor.editor.state.doc, at)),
  );
}

/** A toolbar control, taken off the shipped table rather than restated. */
function pressButton(editor: EditorInstance, title: string): void {
  const entry = shippedButtons.find((b) => b.title === title);
  if (!entry || !isActionEntry(entry)) throw new Error(`no toolbar control titled ${title}`);
  entry.action(editor.editor, { onLink: () => {}, onImageDescription: () => {} });
}

/**
 * The routes, each named as the person reaches it, and each running the code
 * the application runs rather than a copy of it.
 */
const ROUTES: ReadonlyArray<readonly [string, (editor: EditorInstance) => void]> = [
  ['the toolbar button for inline code', (e) => pressButton(e, 'Inline code (Ctrl+E)')],
  ['Ctrl+E, the keymap binding', (e) => e.editor.chain().focus().toggleCode().run()],
  ['the toolbar button for the fenced block', (e) => pressButton(e, 'Code block (Ctrl+Shift+K)')],
  ['Ctrl+Shift+K, the global shortcut', (e) => codeBlockRoutes(e.editor).onCodeBlock()],
  ['Edit, then Insert Code Block', (e) => codeBlockRoutes(e.editor).onInsertCodeBlock()],
];

describe('a selected image survives every route (#427)', () => {
  for (const [name, run] of ROUTES) {
    it(`${name} leaves the document untouched`, () => {
      const editor = open(WITH_IMAGE);
      selectNode(editor, 'image');
      run(editor);
      expect(editor.getMarkdown().trim()).toBe(WITH_IMAGE);
    });
  }
});

describe('a selected horizontal rule survives every route (#427)', () => {
  // Three of the five already did nothing here on `8934c82`, and the rows are
  // kept for all five anyway: the rule is by selection type, so a route that
  // began to act on a rule would be the same defect reaching a second node.
  for (const [name, run] of ROUTES) {
    it(`${name} leaves the document untouched`, () => {
      const editor = open(WITH_RULE);
      selectNode(editor, 'horizontalRule');
      run(editor);
      expect(editor.getMarkdown().trim()).toBe(WITH_RULE);
    });
  }
});

describe('and a text selection still reaches every one of them (#427)', () => {
  const EXPECTED: Record<string, string> = {
    'the toolbar button for inline code': '`One two three.`',
    'Ctrl+E, the keymap binding': '`One two three.`',
    'the toolbar button for the fenced block': '```\nOne two three.\n```',
    'Ctrl+Shift+K, the global shortcut': '```\nOne two three.\n```',
    'Edit, then Insert Code Block': '```\nOne two three.\n```',
  };

  for (const [name, run] of ROUTES) {
    it(`${name} still acts`, () => {
      const editor = open(PLAIN);
      editor.editor.commands.setTextSelection({ from: 1, to: PLAIN.length + 1 });
      run(editor);
      expect(editor.getMarkdown().trim()).toBe(EXPECTED[name]);
    });
  }
});

describe('the bar and the menu agree with the commands (#427)', () => {
  for (const [what, source, node] of [
    ['an image', WITH_IMAGE, 'image'],
    ['a horizontal rule', WITH_RULE, 'horizontalRule'],
  ] as const) {
    it(`neither control is drawn over ${what}`, () => {
      const editor = open(source);
      selectNode(editor, node);
      for (const title of ['Inline code (Ctrl+E)', 'Code block (Ctrl+Shift+K)']) {
        const entry = shippedButtons.find((b) => b.title === title);
        if (!entry || !isActionEntry(entry) || !entry.appliesTo) {
          throw new Error(`${title} carries no rule`);
        }
        expect(entry.appliesTo(editor.editor), title).toBe(false);
      }
    });

    it(`the Insert Code Block entry is greyed over ${what}`, () => {
      const editor = open(source);
      selectNode(editor, node);
      expect(codeBlockAvailability(editor.editor)[INSERT_CODE_BLOCK_KEY]).toBe(false);
    });
  }

  it('both are drawn and the entry is offered for a text selection', () => {
    const editor = open(PLAIN);
    editor.editor.commands.setTextSelection({ from: 1, to: 4 });
    for (const title of ['Inline code (Ctrl+E)', 'Code block (Ctrl+Shift+K)']) {
      const entry = shippedButtons.find((b) => b.title === title);
      if (!entry || !isActionEntry(entry) || !entry.appliesTo) {
        throw new Error(`${title} carries no rule`);
      }
      expect(entry.appliesTo(editor.editor), title).toBe(true);
    }
    expect(codeBlockAvailability(editor.editor)[INSERT_CODE_BLOCK_KEY]).toBe(true);
  });
});
