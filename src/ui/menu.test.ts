import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The shipped page, so a menu entry deleted from the real markup fails here
// rather than at the user's first click (setupMenu asserts every id exists).
import shippedPage from '../../index.html?raw';
import { insertMenuCallbacks } from '../editor/insert-blocks';
import { createEditor, type EditorInstance } from '../editor/setup';
import { type MenuCallbacks, setupMenu } from './menu';

function callbacks(): MenuCallbacks {
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
    onInsertTable: vi.fn(),
    onInsertMedia: vi.fn(),
    onInsertCodeBlock: vi.fn(),
    onInsertChecklist: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
    onToggleSidebar: vi.fn(),
    onAbout: vi.fn(),
  };
}

/**
 * The page's `<header>`, which holds the hamburger and its dropdown. Only that
 * fragment: mounting the whole document would send happy-dom fetching the
 * stylesheet and the icons.
 */
function shippedHeaderMarkup(): string {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  return shippedPage.slice(open, close + '</header>'.length);
}

beforeEach(() => {
  // innerHTML does not execute scripts, so this is just the markup — the same
  // elements main.ts binds at boot.
  document.body.innerHTML = shippedHeaderMarkup();
});

describe('setupMenu', () => {
  it('binds every entry the hamburger menu ships', () => {
    expect(() => setupMenu(callbacks())).not.toThrow();
  });

  it('opens About from the Help entry', () => {
    const handlers = callbacks();
    setupMenu(handlers);

    document.getElementById('menu-about')!.click();

    expect(handlers.onAbout).toHaveBeenCalledTimes(1);
  });

  it('closes the menu when About is chosen', () => {
    setupMenu(callbacks());
    const dropdown = document.getElementById('menu-dropdown')!;

    document.getElementById('menu-toggle')!.click();
    expect(dropdown.classList.contains('hidden')).toBe(false);

    document.getElementById('menu-about')!.click();
    expect(dropdown.classList.contains('hidden')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The two entries #266 added, driven end to end
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A checkbox and a rule are the two constructs #266 gave a visible route to,
 * and both were reachable only by typing before it. What has to be asserted is
 * not that the entries are in the markup — that is the trap this project has
 * collected ten decorative tests from, and in a menu it takes the shape of
 * asserting an entry exists rather than that pressing it did anything.
 *
 * So these click the **real rendered entry** out of the shipped page, through
 * the real `setupMenu` binding, into the **real command** imported from
 * `insert-blocks.ts` rather than restated here, and then assert **what the
 * document became**. A wrong binding — the #204 shape, a control that points at
 * one capability and runs another — is what they exist to catch, and it is the
 * shape fourteen of the other fifteen entries still have nothing standing
 * against.
 *
 * **The mapping is imported, not restated.** `insertMenuCallbacks` is the same
 * object `main.ts` spreads into `setupMenu`, so a swap between the two commands
 * reddens here wherever it is made. Restating the two callbacks in this file
 * was the first shape of it, and the reversal measured what that was worth:
 * pointing the rule entry at the checklist command turned zero of 2813 tests
 * red.
 *
 * **What is still not covered, stated rather than implied**: `main.ts` cannot
 * be imported without booting the application, so no test here watches it. The
 * compiler does instead — `MenuCallbacks` requires both keys, so a `main.ts`
 * that stopped supplying them would not build.
 *
 * No layout is involved in any of it, so nothing here is owed to a manual pass.
 */

let instance: EditorInstance | null = null;

/** An editor on a host of its own, alongside the header markup already mounted. */
function openEditor(markdown = ''): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  if (markdown.length > 0) instance.setMarkdown(markdown);
  return instance;
}

/**
 * The menu wired the way `main.ts` wires it: every other entry is a spy, and
 * the two under test come from `insertMenuCallbacks`, which is the same object
 * `main.ts` spreads. Restating the two callbacks here instead was measured and
 * is what the comment on that function records.
 */
function menuOverEditor(editor: EditorInstance): void {
  setupMenu({
    ...callbacks(),
    ...insertMenuCallbacks(editor.editor),
  });
}

function chooseEntry(id: string): void {
  document.getElementById(id)!.click();
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('the Insert entries make what they are named for', () => {
  it('makes a task list from the Checklist entry, at an empty caret', () => {
    const editor = openEditor();
    menuOverEditor(editor);
    editor.editor.commands.focus();
    expect(editor.editor.state.selection.empty).toBe(true);

    chooseEntry('menu-insert-checklist');

    expect(editor.editor.isActive('taskList')).toBe(true);
    expect(editor.editor.isActive('horizontalRule')).toBe(false);
  });

  it('makes a horizontal rule from the Horizontal Rule entry', () => {
    const editor = openEditor('a\n\nb');
    menuOverEditor(editor);
    editor.editor.commands.focus();

    chooseEntry('menu-insert-horizontal-rule');

    expect(editor.getMarkdown()).toContain('---');
    expect(editor.editor.isActive('taskList')).toBe(false);
  });

  it('leaves the document alone until an entry is pressed', () => {
    const editor = openEditor('a');
    menuOverEditor(editor);
    editor.editor.commands.focus();

    // Binding the menu is not using it. Without this the two above would pass
    // over a document that was already what they assert.
    expect(editor.getMarkdown()).toBe('a');
    expect(editor.editor.isActive('taskList')).toBe(false);
  });
});

/**
 * The round trip #266 asks for, over a construct made by the **menu route**
 * rather than by typing. The distinction is not a formality on the checklist
 * row: `markTaskLists` in the parser is what marks a **typed** list, and it is
 * load-bearing together with the widened `listItem` from #110, while a list the
 * command makes is built as a `taskList` node directly. The two reach the
 * document by different routes, and the task marker already carries recorded
 * exceptions from #157 and #165.
 *
 * Written out, read back into a second editor, written again, and compared as
 * bytes — which is the R-C2 question rather than a rendering one.
 */
function rereadThroughAFreshEditor(markdown: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const second = createEditor(host);
  try {
    second.setMarkdown(markdown);
    return second.getMarkdown();
  } finally {
    second.destroy();
    host.remove();
  }
}

describe('what the Insert entries make survives a round trip', () => {
  it('round-trips a checklist made from the menu', () => {
    const editor = openEditor();
    menuOverEditor(editor);
    editor.editor.commands.focus();

    chooseEntry('menu-insert-checklist');
    editor.editor.commands.insertContent('milk');

    const written = editor.getMarkdown();
    expect(written).toBe('- [ ] milk');
    expect(rereadThroughAFreshEditor(written)).toBe(written);
  });

  it('round-trips a checklist made from the menu and then ticked', () => {
    const editor = openEditor();
    menuOverEditor(editor);
    editor.editor.commands.focus();

    chooseEntry('menu-insert-checklist');
    editor.editor.commands.insertContent('milk');
    // The tick is a second transition on a different route: the command makes
    // an unticked item, and the checkbox is what changes the attribute.
    editor.editor.commands.updateAttributes('taskItem', { checked: true });

    const written = editor.getMarkdown();
    expect(written).toBe('- [x] milk');
    expect(rereadThroughAFreshEditor(written)).toBe(written);
  });

  it('round-trips a horizontal rule made from the menu, between two paragraphs', () => {
    const editor = openEditor('a\n\nb');
    menuOverEditor(editor);
    // The end of the first paragraph, so the rule lands between the two.
    editor.editor.commands.focus();
    editor.editor.commands.setTextSelection(3);

    chooseEntry('menu-insert-horizontal-rule');

    const written = editor.getMarkdown();
    expect(written).toBe('a\n\n---\n\nb');
    expect(rereadThroughAFreshEditor(written)).toBe(written);
  });
});
