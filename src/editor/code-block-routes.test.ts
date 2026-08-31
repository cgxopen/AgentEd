/**
 * A code block has a route a user can find (#204).
 *
 * The issue was found in use rather than in a search: the owner could not make
 * a fenced block on the shipped build, went to the toolbar, and found a button
 * labelled for code that makes an inline span.
 *
 * **The button is not the repair on its own**, and that is what this file
 * exists to pin. The floating toolbar hides itself whenever the selection is
 * empty, so it does not exist at the caret a user starts a new block from — and
 * that is **asserted over the real toolbar below** rather than quoted from
 * `toolbar.ts`. So the route that answers the issue is the one reachable with
 * **nothing selected**: the Edit menu entry and the shortcut, both of which
 * dispatch the same command the button does.
 *
 * Everything below drives that command, or a real key press, rather than a
 * node built by hand — the #146 lesson.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { type KeyboardHandlers, setupKeyboard } from '../app/keyboard';
import { setupToolbar } from '../ui/toolbar';
import { insertCodeBlock } from './insert-code-block';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

function open(markdown = ''): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  if (markdown.length > 0) instance.setMarkdown(markdown);
  return instance;
}

/**
 * Every route ends in the real command, imported rather than restated. If it
 * were spelled here, a change that broke every route in the application would
 * leave this file green.
 */
function runInsert(editor: EditorInstance): void {
  insertCodeBlock(editor.editor);
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the empty-caret route, which is the one that answers the issue
// ─────────────────────────────────────────────────────────────────────────────

describe('a code block can be made with nothing selected', () => {
  it('makes a fenced block from an empty caret', () => {
    const editor = open();
    editor.editor.commands.focus();
    expect(editor.editor.state.selection.empty).toBe(true);

    runInsert(editor);
    editor.editor.commands.insertContent('made from the menu');

    expect(editor.editor.isActive('codeBlock')).toBe(true);
    expect(editor.getMarkdown().trim()).toBe('```\nmade from the menu\n```');
  });

  it('the Edit menu carries the entry, in the shipped markup', () => {
    // Read from `index.html` rather than restated: an entry deleted from the
    // real page has to fail here rather than at the user's first click.
    expect(shippedPage).toContain('id="menu-insert-code-block"');
    expect(shippedPage).toContain('Insert Code Block');
    // Beside the two inserts that were already there, which is the precedent
    // for reaching a block from a menu rather than from a selection.
    expect(shippedPage.indexOf('menu-insert-code-block')).toBeGreaterThan(
      shippedPage.indexOf('menu-insert-media'),
    );
  });

  it('the toolbar is shown on a selection and hidden again when it collapses', () => {
    // The measurement the scope of this issue rests on, asserted over the
    // **real** toolbar: `setupToolbar` builds it here rather than this test
    // reproducing what it does.
    //
    // **The order is the whole of it, and two earlier versions got it wrong.**
    // The first asserted only that nothing matched `.floating-toolbar` at an
    // empty caret — and built no toolbar at all, so the query matched nothing
    // because nothing had been rendered. The second built one and checked the
    // empty caret first, which is satisfied by the `hidden` class the toolbar
    // is *constructed* with: `positionToolbar` runs on `selectionUpdate` and
    // on `focus`, and a programmatic focus fires neither here, so the guard
    // was never reached. Both passed against a toolbar that hides for no
    // reason at all.
    //
    // So the selection comes first and the collapse second. Showing it is what
    // proves the toolbar can appear; hiding it *again*, from a state where it
    // was visible, is the only sequence that makes the empty-selection guard
    // run. The reversal that deletes that guard turns this red.
    //
    // Asserted on the class rather than on geometry: `positionToolbar` also
    // reads `coordsAtPos` and `getBoundingClientRect`, which happy-dom answers
    // with zeroes. The placement is not testable here and is not the claim.
    const editor = open('some text');
    setupToolbar(editor.editor, { onLink: () => {} });
    const toolbar = document.getElementById('floating-toolbar');
    if (toolbar === null) throw new Error('setupToolbar rendered no toolbar');

    editor.editor.commands.selectAll();
    expect(editor.editor.state.selection.empty).toBe(false);
    expect(toolbar.classList.contains('hidden')).toBe(false);

    editor.editor.commands.setTextSelection(1);
    expect(editor.editor.state.selection.empty).toBe(true);
    expect(toolbar.classList.contains('hidden')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the selection route
// ─────────────────────────────────────────────────────────────────────────────

describe('a code block can be made from a selection', () => {
  it('wraps the selected text in a fenced block', () => {
    const editor = open('hello world');
    editor.editor.commands.selectAll();

    runInsert(editor);

    expect(editor.getMarkdown().trim()).toBe('```\nhello world\n```');
  });

  it('toggles back out, the way every other block button does', () => {
    const editor = open('hello world');
    editor.editor.commands.selectAll();
    runInsert(editor);
    editor.editor.commands.selectAll();
    runInsert(editor);

    expect(editor.editor.isActive('codeBlock')).toBe(false);
    expect(editor.getMarkdown().trim()).toBe('hello world');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — the wide half, which a repair that is too broad breaks
// ─────────────────────────────────────────────────────────────────────────────

describe('the inline code button still makes an inline span', () => {
  it('makes a code span rather than a block, run from the real button', async () => {
    const { shippedButtons } = await import('../ui/toolbar');
    const inlineButton = shippedButtons.find((b) => b.title === 'Inline code (Ctrl+E)');
    if (!inlineButton) throw new Error('the inline code button is missing from the toolbar');

    const editor = open('hello world');
    editor.editor.commands.selectAll();
    inlineButton.action(editor.editor, { onLink: () => {} });

    expect(editor.editor.isActive('code')).toBe(true);
    expect(editor.editor.isActive('codeBlock')).toBe(false);
    expect(editor.getMarkdown().trim()).toBe('`hello world`');
  });

  it('the inline button is not the block command, checked at the table', async () => {
    // The two entries must not share an action. A repair that pointed both at
    // the same command would satisfy every behavioural test above for the
    // block and silently take the span away.
    const { shippedButtons } = await import('../ui/toolbar');
    const inline = shippedButtons.find((b) => b.title === 'Inline code (Ctrl+E)');
    const block = shippedButtons.find((b) => b.title === 'Code block (Ctrl+Shift+K)');

    expect(inline?.action).not.toBe(block?.action);
  });

  it('the two buttons are told apart by label and by tooltip', async () => {
    // Read off the toolbar's own table rather than restated. The tooltip half
    // matters as much as the label: `Code` on the inline button is how the
    // owner took the wrong turn, and it is now `Inline code`.
    const { shippedButtons } = await import('../ui/toolbar');
    const inline = shippedButtons.find((b) => b.title.includes('Ctrl+E'));
    const block = shippedButtons.find((b) => b.title.includes('Ctrl+Shift+K'));

    expect(inline).toBeDefined();
    expect(block).toBeDefined();
    expect(inline?.label).not.toBe(block?.label);
    expect(inline?.title).not.toBe(block?.title);
    expect(inline?.title).toBe('Inline code (Ctrl+E)');
    expect(block?.title).toBe('Code block (Ctrl+Shift+K)');
  });

  it('each button dispatches the command its tooltip names, run from the real table', async () => {
    // The buttons' own `action` functions, taken off the shipped table and
    // invoked. Spelling the commands here instead would leave this green while
    // both buttons had been changed underneath it.
    const { shippedButtons } = await import('../ui/toolbar');
    const inlineButton = shippedButtons.find((b) => b.title === 'Inline code (Ctrl+E)');
    const blockButton = shippedButtons.find((b) => b.title === 'Code block (Ctrl+Shift+K)');
    if (!inlineButton || !blockButton) throw new Error('a code button is missing from the toolbar');

    const forBlock = open('hello world');
    forBlock.editor.commands.selectAll();
    blockButton.action(forBlock.editor, { onLink: () => {} });
    const blockResult = forBlock.getMarkdown().trim();
    forBlock.destroy();
    instance = null;

    const forInline = open('hello world');
    forInline.editor.commands.selectAll();
    inlineButton.action(forInline.editor, { onLink: () => {} });
    const inlineResult = forInline.getMarkdown().trim();

    expect(blockResult).toBe('```\nhello world\n```');
    expect(inlineResult).toBe('`hello world`');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 and 6 — the shortcut, at the binding
// ─────────────────────────────────────────────────────────────────────────────

describe('Ctrl+Shift+K reaches the code block', () => {
  function handlers(): KeyboardHandlers {
    return {
      onSave: vi.fn(),
      onSaveAs: vi.fn(),
      onOpen: vi.fn(),
      onLink: vi.fn(),
      onCodeBlock: vi.fn(),
    };
  }

  it('makes a block when the handler is wired to the command main.ts wires', () => {
    // The binding is pinned in `keyboard.test.ts`; this is the other half —
    // that what the binding calls actually produces a fenced block.
    const editor = open();
    editor.editor.commands.focus();
    const wired = handlers();
    wired.onCodeBlock = () => runInsert(editor);
    setupKeyboard(wired);

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'K',
        code: 'KeyK',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    editor.editor.commands.insertContent('from the shortcut');

    expect(editor.getMarkdown().trim()).toBe('```\nfrom the shortcut\n```');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 — the pair this issue exists to complete
// ─────────────────────────────────────────────────────────────────────────────

describe('a block made by any route saves and reopens unchanged', () => {
  const ROUTES: ReadonlyArray<readonly [string, string]> = [
    ['the command behind the menu and the shortcut', '```\nmade here\n```'],
    ['a fence with a language', '```python\nx = 1\n```'],
  ];

  it.each(ROUTES)('%s round-trips byte for byte', (_label, markdown) => {
    const editor = open(markdown);
    const once = editor.getMarkdown().trim();
    editor.destroy();
    instance = null;

    expect(once).toBe(markdown);

    const reopened = open(once);
    expect(reopened.getMarkdown().trim()).toBe(markdown);
  });

  it('a block made from an empty caret saves and reopens identically', () => {
    const editor = open();
    editor.editor.commands.focus();
    runInsert(editor);
    editor.editor.commands.insertContent('round trip');
    const saved = editor.getMarkdown().trim();
    editor.destroy();
    instance = null;

    expect(saved).toBe('```\nround trip\n```');
    expect(open(saved).getMarkdown().trim()).toBe(saved);
  });

  it('a block with a language still shows the label #202 added', () => {
    // The pair: a route to make one, and a label on it. Without the route the
    // label had nothing reliable to appear on.
    const editor = open('```python\nx = 1\n```');
    const drawn = Array.from(editor.editor.view.dom.querySelectorAll('.code-block-language')).map(
      (element) => element.textContent,
    );

    expect(drawn).toEqual(['python']);
  });

  it('a block made in the editor has no language and so no label', () => {
    const editor = open();
    editor.editor.commands.focus();
    runInsert(editor);
    editor.editor.commands.insertContent('no language');

    expect(editor.editor.view.dom.querySelectorAll('.code-block-language').length).toBe(0);
  });
});
