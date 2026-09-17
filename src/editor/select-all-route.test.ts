/**
 * Select All in the Edit section (#323).
 *
 * Every row clicks the **real rendered entry** out of the shipped page, reached
 * the way a person reaches it — the toggle, then the section, then the entry —
 * through the real `setupMenu` into `selectAllMenuCallbacks`, the object
 * `main.ts` hands the menu, and reads the selection off the **real editor**.
 * Never the mapping object: that is the #286 lesson, and which handler the
 * entry calls is pinned by the table in `menu.test.ts` rather than here.
 *
 * **Nothing here is layout.** Where the floating toolbar lands on a
 * whole-document selection is the half no harness sees, and it is the half this
 * work measured in a browser: the bar is drawn 40 px below the window, at the
 * default window and at the minimum, at every scroll position. That is not this
 * entry's doing — a selection extended past the viewport with the keyboard does
 * the same, 39.1 px below — and the owner decision that answers it belongs to
 * its own issue. Said here because a row that appeared to cover it would be the
 * worse outcome.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { type MenuCallbacks, setupMenu } from '../ui/menu';
import { selectAllMenuCallbacks } from './select-all-route';
import { createEditor, type EditorInstance } from './setup';

/**
 * The Table entries are not what this file tests, so the menu greys all seven:
 * an entry whose key the reading does not carry is greyed (#292).
 */
const noTableShape = () => ({});

function spies(): MenuCallbacks {
  return {
    onNew: vi.fn(),
    onNewFromTemplate: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onClose: vi.fn(),
    onFind: vi.fn(),
    onReplace: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSelectAll: vi.fn(),
    onInsertTable: vi.fn(),
    onInsertMedia: vi.fn(),
    onInsertCodeBlock: vi.fn(),
    onInsertChecklist: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
    onInsertMetadata: vi.fn(),
    onInsertEmoji: vi.fn(),
    onAddRowAbove: vi.fn(),
    onAddRowBelow: vi.fn(),
    onDeleteRow: vi.fn(),
    onAddColumnBefore: vi.fn(),
    onAddColumnAfter: vi.fn(),
    onDeleteColumn: vi.fn(),
    onDeleteTable: vi.fn(),
    onToggleSidebar: vi.fn(),
    onAbout: vi.fn(),
  };
}

function shippedHeaderMarkup(): string {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  return shippedPage.slice(open, close + '</header>'.length);
}

let instance: EditorInstance | null = null;

beforeEach(() => {
  document.body.innerHTML = shippedHeaderMarkup();
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

/** An editor holding `markdown`, with the real menu bound over it as `main.ts` binds it. */
function openWithMenu(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  setupMenu(
    { ...spies(), ...selectAllMenuCallbacks(instance.editor) },
    () => ({ canUndo: false, canRedo: false }),
    noTableShape,
  );
  return instance;
}

/** Chooses the entry the way a person does. */
function chooseSelectAll(): void {
  document.getElementById('menu-toggle')!.click();
  document.getElementById('menu-section-edit')!.click();
  (document.getElementById('menu-select-all') as HTMLButtonElement).click();
}

/** What the editor's selection covers, as positions and as the text inside them. */
function selection(editor: EditorInstance): {
  from: number;
  to: number;
  text: string;
  size: number;
} {
  const { state } = editor.editor;
  const { from, to } = state.selection;
  return { from, to, text: state.doc.textBetween(from, to, '\n'), size: state.doc.content.size };
}

describe('the entry selects the whole document', () => {
  it('covers it from the first position to the last', () => {
    const editor = openWithMenu('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
    const before = selection(editor);
    expect(before.from).toBe(before.to);

    chooseSelectAll();

    const after = selection(editor);
    expect(after.from).toBe(0);
    expect(after.to).toBe(after.size);
    expect(after.text).toContain('First paragraph.');
    expect(after.text).toContain('Third paragraph.');
  });

  it('covers a table and a fenced block, which a paragraph-wise selection would not', () => {
    // Measured in Chromium before this was written: the chord's selection
    // intersects both nodes. The entry has to reach as far or it is a different
    // capability wearing the same word.
    const editor = openWithMenu(
      [
        'Before.',
        '',
        '| a | b |',
        '| --- | --- |',
        '| c | d |',
        '',
        '```js',
        'const x = 1;',
        '```',
        '',
        'After.',
      ].join('\n'),
    );
    chooseSelectAll();

    const { from, to, size } = selection(editor);
    expect(from).toBe(0);
    expect(to).toBe(size);

    const types: string[] = [];
    editor.editor.state.doc.nodesBetween(from, to, (node) => {
      types.push(node.type.name);
    });
    expect(types).toContain('table');
    expect(types).toContain('codeBlock');
  });

  it('reaches the same selection the chord reaches', () => {
    // Two routes to one operation rather than one function: the chord runs the
    // base keymap's command and the entry runs the one TipTap exposes. What
    // they share is the selection, so the selection is what is compared —
    // asserting they are the same call would be asserting something untrue.
    const editor = openWithMenu('One.\n\nTwo.\n\nThree.');
    chooseSelectAll();
    const viaEntry = selection(editor);

    editor.editor.commands.setTextSelection(1);
    expect(selection(editor).from).toBe(1);

    editor.editor.commands.selectAll();
    const viaCommand = selection(editor);

    expect(viaEntry.from).toBe(viaCommand.from);
    expect(viaEntry.to).toBe(viaCommand.to);
  });

  it('leaves the document itself alone', () => {
    const markdown = 'Untouched.\n\nStill untouched.';
    const editor = openWithMenu(markdown);
    const before = editor.getMarkdown();
    chooseSelectAll();
    expect(editor.getMarkdown()).toBe(before);
  });
});

describe('the states the report named', () => {
  it('selects an empty document without throwing, and changes nothing about it', () => {
    // The one state where the press does nothing to the document. It is not
    // greyed here: the issue asks for the door and no more, and the state
    // becomes a press with no visible effect only once the floating toolbar
    // stops coming up for it — which is another issue's change.
    const editor = openWithMenu('');
    expect(() => chooseSelectAll()).not.toThrow();
    const { from, to, text } = selection(editor);
    expect(text).toBe('');
    expect(from).toBeLessThanOrEqual(to);
    expect(editor.getMarkdown()).toBe('');
  });

  it('covers the document the editor holds, and the metadata block is not in it', () => {
    // #305: the metadata block is application state written outside any
    // transaction, and the split that takes it out of the markdown happens
    // **above** the editor — `metadata-split.test.ts` is where that is pinned.
    // This rig calls `setMarkdown` directly, so it is deliberately not asserted
    // here: a row that loaded frontmatter through this door and then claimed
    // the selection misses it would be testing the rig.
    //
    // What was measured instead, in Chromium against the shipped page: after a
    // select-all and a Delete, the metadata textarea holds its five lines
    // character for character, the badge stays up, and the document is empty.
    // `#frontmatter-input` is not inside `.ProseMirror`, so no selection can
    // reach it. The row below asserts the half this harness owns — the schema
    // the editor selects over has no node for a metadata block at all.
    const editor = openWithMenu('Body.');
    chooseSelectAll();
    expect(Object.keys(editor.editor.schema.nodes)).not.toContain('frontmatter');
    expect(selection(editor).text).toBe('Body.');
  });
});
