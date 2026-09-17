/**
 * Insert Checklist, pressed with the caret already inside a checklist (#275).
 *
 * Until #275 the entry ran `toggleTaskList`, and a toggle toggles out: the
 * entry named Insert took the checklist away. The owner decision of 2026-09-11
 * is that the command moves and the name stays — inside a checklist item the
 * entry adds a fresh unticked item after it, and every other state keeps what
 * it did.
 *
 * Nothing here is layout, so nothing here is owed to a manual pass: every row
 * clicks the **real rendered entry** out of the shipped page, through the real
 * `setupMenu` binding, into `insertMenuCallbacks` — the object `main.ts`
 * spreads — and asserts the document that resulted. That is the shape
 * `menu.test.ts` set in #266, and `code-block-routes.test.ts` before it.
 *
 * It sits beside `insert-blocks.ts` rather than inside `menu.test.ts` because
 * what it pins is how that module behaves across caret states, while the menu
 * file pins which entry reaches which function. The menu file's three checklist
 * witnesses all start from an empty caret, the branch this change leaves alone,
 * so they pass for the same reason they did before it.
 *
 * ── Two properties asserted on their own ──
 *
 * The rows assert exact bytes, which implies everything. Two properties are
 * then asserted separately, because they are the two halves of the decision and
 * a regression could lose either one without the other: **it removes nothing**,
 * which is the defect, and **it is never a silent press**, which is why the
 * answer that did nothing was turned down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { type MenuCallbacks, setupMenu } from '../ui/menu';
import { insertMenuCallbacks } from './insert-blocks';
import { createEditor, type EditorInstance } from './setup';

/**
 * The Table entries are not what this file tests, so the menu greys all seven:
 * an entry whose key the reading does not carry is greyed (#292).
 */
const noTableShape = () => ({});

/** Undo and Redo are not what this file tests, so the menu greys them. */
const nothingToUndo = () => ({ canUndo: false, canRedo: false });

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
    onImageDescription: vi.fn(),
    onAddRowAbove: vi.fn(),
    onAddRowBelow: vi.fn(),
    onDeleteRow: vi.fn(),
    onAddColumnBefore: vi.fn(),
    onAddColumnAfter: vi.fn(),
    onDeleteColumn: vi.fn(),
    onDeleteTable: vi.fn(),
    onAbout: vi.fn(),
  };
}

/** The shipped `<header>` alone: mounting the whole page would fetch assets. */
function shippedHeaderMarkup(): string {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  return shippedPage.slice(open, close + '</header>'.length);
}

let instance: EditorInstance | null = null;

/** An editor holding `markdown`, with the real menu bound over it. */
function openWithMenu(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  if (markdown.length > 0) instance.setMarkdown(markdown);
  setupMenu({ ...spies(), ...insertMenuCallbacks(instance.editor) }, nothingToUndo, noTableShape);
  instance.editor.commands.focus();
  return instance;
}

function pressInsertChecklist(): void {
  document.getElementById('menu-insert-checklist')!.click();
}

/** The position `offset` characters into the `nth` node of this type. */
function inside(editor: EditorInstance, type: string, offset = 0, nth = 0): number {
  let found = -1;
  let seen = 0;
  editor.editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === type) {
      if (seen === nth) found = pos + 1 + offset;
      seen += 1;
    }
    return true;
  });
  if (found < 0) throw new Error(`no ${type} number ${nth} in the document`);
  return found;
}

type Place = (editor: EditorInstance) => void;
type Anchor = readonly [type: string, offset: number, nth: number];

const caret =
  (type: string, offset = 0, nth = 0): Place =>
  (editor) => {
    editor.editor.commands.setTextSelection(inside(editor, type, offset, nth));
  };

const span =
  (from: Anchor, to: Anchor): Place =>
  (editor) => {
    editor.editor.commands.setTextSelection({
      from: inside(editor, ...from),
      to: inside(editor, ...to),
    });
  };

function reread(markdown: string): string {
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

/** How many checkboxes the markdown spells, ticked or not. */
function checkboxes(markdown: string): number {
  return (markdown.match(/\[[ x]\]/g) ?? []).length;
}

beforeEach(() => {
  document.body.innerHTML = shippedHeaderMarkup();
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 — inside a checklist: a fresh item after the current one
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each row: the document, where the caret or selection is, and the document
 * after pressing the entry and typing `X` — so each row pins both where the new
 * item landed and that the caret went into it. Every shape here removed or
 * moved a checkbox before #275, measured on `dbe287d`.
 */
const INSIDE_A_CHECKLIST: ReadonlyArray<readonly [string, string, Place, string]> = [
  ['an item, caret mid-word', '- [ ] milk', caret('paragraph', 2), '- [ ] milk\n- [ ] X'],
  ['a ticked item', '- [x] done', caret('paragraph', 2), '- [x] done\n- [ ] X'],
  ['an empty item', '- [ ] ', caret('paragraph'), '- [ ] \n- [ ] X'],
  [
    'the middle item of three',
    '- [ ] a\n- [ ] b\n- [ ] c',
    caret('paragraph', 1, 1),
    '- [ ] a\n- [ ] b\n- [ ] X\n- [ ] c',
  ],
  [
    'a nested item',
    '- [ ] a\n  - [ ] b',
    caret('paragraph', 1, 1),
    '- [ ] a\n  - [ ] b\n  - [ ] X',
  ],
  ['an item holding a heading', '- [ ] ## h', caret('heading', 1), '- [ ] ## h\n- [ ] X'],
  [
    'an item holding a fence, caret in the code',
    '- [ ] ```\n  code\n  ```',
    caret('codeBlock', 2),
    '- [ ] ```\n  code\n  ```\n- [ ] X',
  ],
  // The shape `splitListItem` broke: it split the item between its two
  // paragraphs. Here `b` stays in the first item — written one newline apart,
  // which is the recorded R-C2 exception for two paragraphs in one task item.
  [
    'an item holding two paragraphs, caret in the first',
    '- [ ] a\n\n  b',
    caret('paragraph', 1, 0),
    '- [ ] a\n  b\n- [ ] X',
  ],
  [
    'a blockquote inside an item',
    '- [ ] a\n\n  > q',
    caret('paragraph', 1, 1),
    '- [ ] a\n  > q\n- [ ] X',
  ],
  [
    'a loose checklist',
    '- [ ] a\n\n- [ ] b',
    caret('paragraph', 1, 0),
    '- [ ] a\n\n- [ ] X\n\n- [ ] b',
  ],
  [
    'a selection inside the item text',
    '- [ ] milk',
    span(['paragraph', 1, 0], ['paragraph', 3, 0]),
    '- [ ] milk\n- [ ] X',
  ],
  [
    'a selection across two items',
    '- [ ] one\n- [ ] two',
    span(['paragraph', 1, 0], ['paragraph', 1, 1]),
    '- [ ] one\n- [ ] two\n- [ ] X',
  ],
  [
    'a selection from a paragraph into a checklist',
    'p\n\n- [ ] one',
    span(['paragraph', 0, 0], ['paragraph', 1, 1]),
    'p\n\n- [ ] one\n- [ ] X',
  ],
];

describe('Insert Checklist inside a checklist adds a fresh item after the current one', () => {
  it.each(INSIDE_A_CHECKLIST)('%s', (_label, markdown, place, expected) => {
    const editor = openWithMenu(markdown);
    place(editor);

    pressInsertChecklist();
    editor.editor.commands.insertContent('X');

    expect(editor.getMarkdown()).toBe(expected);
  });

  it('removes nothing, in any of those states', () => {
    for (const [label, markdown, place] of INSIDE_A_CHECKLIST) {
      const editor = openWithMenu(markdown);
      place(editor);
      const before = editor.getMarkdown();

      pressInsertChecklist();

      const after = editor.getMarkdown();
      expect(checkboxes(after), label).toBeGreaterThanOrEqual(checkboxes(before));
      for (const word of before.match(/[a-z]+/g) ?? []) {
        expect(after, `${label}: ${word}`).toContain(word);
      }
      editor.destroy();
      instance = null;
    }
  });

  it('is never a silent press, in any of those states', () => {
    for (const [label, markdown, place] of INSIDE_A_CHECKLIST) {
      const editor = openWithMenu(markdown);
      place(editor);
      const before = editor.getMarkdown();

      pressInsertChecklist();

      expect(editor.getMarkdown(), label).not.toBe(before);
      editor.destroy();
      instance = null;
    }
  });

  it('is one step of undo, which gives the document back exactly', () => {
    const editor = openWithMenu('- [ ] a\n- [ ] b');
    caret('paragraph', 1, 0)(editor);

    pressInsertChecklist();
    editor.editor.commands.undo();

    expect(editor.getMarkdown()).toBe('- [ ] a\n- [ ] b');
  });

  it('asks for the new item to be scrolled into view', () => {
    // The scrolling itself is layout, which this harness does not have. What
    // it can see is the request on the transaction that adds the item.
    const editor = openWithMenu('- [ ] milk');
    caret('paragraph', 2)(editor);
    const scrolled: boolean[] = [];
    editor.editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) scrolled.push(transaction.scrolledIntoView);
    });

    pressInsertChecklist();

    expect(scrolled).toEqual([true]);
  });

  it('writes what it adds so that it reads back the same, once the item holds text', () => {
    // The two-paragraph row is left out because its first save is the recorded
    // exception, not anything this entry does. And an **empty** nested item is
    // the labelled gap in `roundtrip.test.ts` (#160) — it loses its marker on
    // save whichever route made it, and Enter makes the same bytes this entry
    // does, so the rows here are taken once `X` is in the new item.
    for (const [label, markdown, place] of INSIDE_A_CHECKLIST) {
      if (label.startsWith('an item holding two paragraphs')) continue;
      const editor = openWithMenu(markdown);
      place(editor);
      const before = editor.getMarkdown();

      pressInsertChecklist();
      editor.editor.commands.insertContent('X');

      const written = editor.getMarkdown();
      // Every fixture here round-trips on its own, so without this the loop
      // would pass over a document the entry never touched.
      expect(checkboxes(written), label).toBe(checkboxes(before) + 1);
      expect(reread(written), label).toBe(written);
      editor.destroy();
      instance = null;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — everywhere else: what the entry already did
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Horizontal Rule entry, pressed with the caret in a table cell (#282).
 *
 * A cell takes any block, so the entry lands a rule there — measured, it is one
 * of the two routes that reach the shape, the other being the `---` input rule.
 * Until #282 the rule was written as `---` flattened into the cell and read back
 * as text, so the construct was gone by the next open.
 */
describe('Insert Horizontal Rule in a table cell', () => {
  it('writes a rule the file can hold, and the rule comes back', () => {
    const editor = openWithMenu('| a | b |\n| --- | --- |\n| 1 | 2 |');
    caret('paragraph', 1, 2)(editor);

    document.getElementById('menu-insert-horizontal-rule')!.click();

    const written = editor.getMarkdown();
    expect(written).toBe('| a | b |\n| --- | --- |\n| 1<hr> | 2 |');
    expect(reread(written)).toBe(written);
    expect(written).toContain('<hr>');
  });

  it('still writes a rule outside a cell as three characters', () => {
    // The half that catches an overcorrection: nothing about a rule outside a
    // cell moves, and `---` is what a file holding one is spelled with.
    const editor = openWithMenu('a\n\nb');
    caret('paragraph', 1, 0)(editor);

    document.getElementById('menu-insert-horizontal-rule')!.click();

    expect(editor.getMarkdown()).toBe('a\n\n---\n\nb');
  });
});

describe('Insert Checklist outside a checklist keeps what it did', () => {
  it('still makes a checklist from an empty caret, with the caret in it', () => {
    // The case #266 exists for, and the half that catches an overcorrection:
    // a repair that only ever added items would break this row first.
    const editor = openWithMenu('');
    expect(editor.editor.state.selection.empty).toBe(true);

    pressInsertChecklist();
    editor.editor.commands.insertContent('X');

    expect(editor.getMarkdown()).toBe('- [ ] X');
  });

  /**
   * Pinned as #275 left them, not as what each ought to be. The bullet and
   * ordered rows nest a checklist inside the item instead of converting the
   * list; that is the question the owner decision set aside to be answered on
   * its own, and whoever answers it has to move these rows, which is the point.
   * The last two show the nearest list item and the end of the selection
   * deciding, as the comment on `insertChecklist` says.
   */
  const UNCHANGED: ReadonlyArray<readonly [string, string, Place, string]> = [
    ['a paragraph with text', 'hello', caret('paragraph', 2), '- [ ] hello'],
    [
      'a selection over three paragraphs',
      'a\n\nb\n\nc',
      span(['paragraph', 0, 0], ['paragraph', 1, 2]),
      '- [ ] a\n- [ ] b\n- [ ] c',
    ],
    ['a bullet list', '- one\n- two', caret('paragraph', 0, 0), '- - [ ] one\n- two'],
    ['an ordered list', '1. one\n2. two', caret('paragraph', 0, 0), '1. - [ ] one\n2. two'],
    ['a blockquote', '> quoted', caret('paragraph', 1), '> - [ ] quoted'],
    [
      // The checklist is in the cell as the entry made it, and since #300 it is
      // written as the task list it is. Until #300 this row expected
      // `| - [ ] 1 |`, the flattened text the next open reads as a paragraph:
      // the row was pinning the loss. That the checklist comes back a checklist
      // is asserted in `cell-blocks.test.ts`, node beside bytes.
      'a table cell',
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
      caret('paragraph', 1, 2),
      '| a | b |\n| --- | --- |\n| <ul><li><input type="checkbox"> 1</li></ul> | 2 |',
    ],
    ['a code block', '```\ncode\n```', caret('codeBlock', 1), '- [ ] ```\n  code\n  ```'],
    [
      'a bullet list nested inside a checklist item',
      '- [ ] a\n  - b',
      caret('paragraph', 1, 1),
      '- [ ] a\n  - - [ ] b',
    ],
    [
      'a selection from a checklist into a paragraph',
      '- [ ] one\n\np',
      span(['paragraph', 1, 0], ['paragraph', 1, 1]),
      '- [ ] - [ ] one\n- [ ] p',
    ],
  ];

  it.each(UNCHANGED)('%s', (_label, markdown, place, expected) => {
    const editor = openWithMenu(markdown);
    place(editor);

    pressInsertChecklist();

    expect(editor.getMarkdown()).toBe(expected);
  });
});
