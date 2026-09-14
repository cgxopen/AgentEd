/**
 * Insert Table, pressed with the caret already inside a table (#278).
 *
 * Until #278 the entry put the new table **inside the cell**, the one place GFM
 * cannot spell a table, and the serializer tore the result apart on the first
 * save. The owner decision of 2026-09-11: inside a table, the new table goes
 * **after** the one the caret is in; outside a table, the entry does what it
 * always did.
 *
 * Nothing here is layout. Every row clicks the **real rendered entry** out of
 * the shipped page, through the real `setupMenu` binding and the real dialog,
 * into `tableMenuCallbacks` — the object `main.ts` spreads — and asserts the
 * document. Until #278 that mapping was spelled inline in `main.ts`, where
 * swapping it with the code-block entry turned zero of 2841 tests red.
 *
 * The rows assert exact bytes. Two properties are then asserted on their own,
 * because they are the two things the decision is for: **it never builds a
 * table inside a cell**, and **what it writes reads back the same**.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { tableMenuCallbacks } from '../app/table-dialog';
import { type MenuCallbacks, setupMenu } from '../ui/menu';
import { createEditor, type EditorInstance } from './setup';

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
    onInsertTable: vi.fn(),
    onInsertMedia: vi.fn(),
    onInsertCodeBlock: vi.fn(),
    onInsertChecklist: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
    onInsertMetadata: vi.fn(),
    onToggleSidebar: vi.fn(),
    onAbout: vi.fn(),
  };
}

/** The shipped `<header>` and the table dialog, without the rest of the page. */
function shippedMarkup(): string {
  const header = shippedPage.indexOf('<header id="menubar">');
  const headerEnd = shippedPage.indexOf('</header>') + '</header>'.length;
  const dialog = shippedPage.indexOf('<div id="table-dialog"');
  const dialogEnd = shippedPage.indexOf('<div id="link-dialog"');
  if (header < 0 || dialog < 0 || dialogEnd < 0) throw new Error('index.html changed shape');
  return shippedPage.slice(header, headerEnd) + shippedPage.slice(dialog, dialogEnd);
}

let instance: EditorInstance | null = null;

function openWithMenu(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  if (markdown.length > 0) instance.setMarkdown(markdown);
  setupMenu({ ...spies(), ...tableMenuCallbacks(instance.editor) });
  instance.editor.commands.focus();
  return instance;
}

/** The entry, then Insert in its dialog — optionally with other numbers typed first. */
function pressInsertTable(size?: { rows: string; cols: string }): void {
  document.getElementById('menu-insert-table')!.click();
  if (size) {
    (document.getElementById('table-rows') as HTMLInputElement).value = size.rows;
    (document.getElementById('table-cols') as HTMLInputElement).value = size.cols;
  }
  document.getElementById('table-confirm')!.click();
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

const caret =
  (type: string, offset = 0, nth = 0): Place =>
  (editor) => {
    editor.editor.commands.setTextSelection(inside(editor, type, offset, nth));
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

/** How many tables the document holds, and how many of them sit inside a cell. */
function tables(doc: ProseMirrorNode): { all: number; inACell: number } {
  let all = 0;
  let inACell = 0;
  doc.descendants((node, _pos, parent) => {
    if (node.type.name !== 'table') return true;
    all += 1;
    if (parent && /^table(Cell|Header)$/.test(parent.type.name)) inACell += 1;
    return true;
  });
  return { all, inACell };
}

beforeEach(() => {
  document.body.innerHTML = shippedMarkup();
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |';
/** The dialog default, three by three with a header row, once `X` is typed in it. */
const NEW_TABLE = '| X |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |';
const indent = (text: string, by: string) =>
  text
    .split('\n')
    .map((line) => by + line)
    .join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1 — inside a table: a new table after it
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each row: the document, where the caret is, and the document after pressing
 * the entry and typing `X` — so each row pins where the new table landed and
 * that the caret went into its first cell. Every one of these put the new
 * table inside the cell before #278.
 */
const INSIDE_A_TABLE: ReadonlyArray<readonly [string, string, Place, string]> = [
  ['a body cell', TABLE, caret('paragraph', 1, 2), `${TABLE}\n\n${NEW_TABLE}`],
  ['a header cell', TABLE, caret('paragraph', 1, 0), `${TABLE}\n\n${NEW_TABLE}`],
  [
    'a table with a paragraph after it',
    `${TABLE}\n\npara`,
    caret('paragraph', 1, 2),
    `${TABLE}\n\n${NEW_TABLE}\n\npara`,
  ],
  [
    'a table in a blockquote',
    indent(TABLE, '> '),
    caret('paragraph', 1, 2),
    `${indent(TABLE, '> ')}\n> \n${indent(NEW_TABLE, '> ')}`,
  ],
  [
    'a table in a bullet item',
    `- x\n\n${indent(TABLE, '  ')}`,
    caret('paragraph', 1, 3),
    `- x\n\n${indent(TABLE, '  ')}\n\n${indent(NEW_TABLE, '  ')}`,
  ],
  // A table inside a cell reaches the document from a file. The new table goes
  // after the outermost one, so the entry never builds that shape itself.
  [
    'a table that is itself inside a cell',
    '| a |\n| --- |\n| <table><tr><td>x</td></tr></table> |',
    caret('paragraph', 1, 1),
    `| a |\n| --- |\n| <table><tr><td>x</td></tr></table> |\n\n${NEW_TABLE}`,
  ],
  // A checklist is the one container the new table leaves, and the reason is the
  // recorded exception rather than a preference: an item's own blocks are written
  // one newline apart, so a second table beside the first inside the item is read
  // back as more rows of the first. Owner decision of 2026-09-11 — it goes after
  // the whole checklist, which reads back unchanged. The blank line these rows
  // lose above the table is that same recorded exception, not this change.
  [
    'a table in a checklist item',
    `- [ ] x\n\n${indent(TABLE, '  ')}`,
    caret('paragraph', 1, 3),
    `- [ ] x\n\n${indent(TABLE, '  ')}\n\n${NEW_TABLE}`,
  ],
  [
    'a table in a checklist item with another item after it',
    `- [ ] x\n\n${indent(TABLE, '  ')}\n\n- [ ] y`,
    caret('paragraph', 1, 3),
    `- [ ] x\n\n${indent(TABLE, '  ')}\n\n- [ ] y\n\n${NEW_TABLE}`,
  ],
  [
    'a checklist inside a bullet item',
    '- b\n\n  - [ ] x\n\n    | a |\n    | --- |\n    | 1 |',
    caret('paragraph', 1, 3),
    `- b\n\n  - [ ] x\n\n    | a |\n    | --- |\n    | 1 |\n\n${indent(NEW_TABLE, '  ')}`,
  ],
];

describe('Insert Table inside a table adds a new table after it', () => {
  it.each(INSIDE_A_TABLE)('%s', (_label, markdown, place, expected) => {
    const editor = openWithMenu(markdown);
    place(editor);

    pressInsertTable();
    editor.editor.commands.insertContent('X');

    expect(editor.getMarkdown()).toBe(expected);
  });

  it('never builds a table inside a cell, in any of those states', () => {
    for (const [label, markdown, place] of INSIDE_A_TABLE) {
      const editor = openWithMenu(markdown);
      place(editor);
      const before = tables(editor.editor.state.doc);

      pressInsertTable();

      expect(tables(editor.editor.state.doc).inACell, label).toBe(before.inACell);
      editor.destroy();
      instance = null;
    }
  });

  it('writes what it makes so that it reads back the same, in any of those states', () => {
    for (const [label, markdown, place] of INSIDE_A_TABLE) {
      const editor = openWithMenu(markdown);
      place(editor);
      const before = tables(editor.editor.state.doc);

      pressInsertTable();

      // Every fixture round-trips on its own, so without this the loop would
      // pass over a document the entry never touched.
      expect(tables(editor.editor.state.doc).all, label).toBe(before.all + 1);
      const written = editor.getMarkdown();
      expect(reread(written), label).toBe(written);
      editor.destroy();
      instance = null;
    }
  });

  it('is one step of undo, which gives the document back exactly', () => {
    const editor = openWithMenu(TABLE);
    caret('paragraph', 1, 2)(editor);

    pressInsertTable();
    editor.editor.commands.undo();

    expect(editor.getMarkdown()).toBe(TABLE);
  });

  it('asks for the new table to be scrolled into view', () => {
    // The scrolling is layout, which this harness does not have; the request
    // on the transaction that adds the table is what it can see.
    const editor = openWithMenu(TABLE);
    caret('paragraph', 1, 2)(editor);
    const scrolled: boolean[] = [];
    editor.editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) scrolled.push(transaction.scrolledIntoView);
    });

    pressInsertTable();

    expect(scrolled).toEqual([true]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — outside a table: what the entry already did
// ─────────────────────────────────────────────────────────────────────────────

describe('Insert Table outside a table keeps what it did', () => {
  it('still makes a table from an empty caret, with the caret in it', () => {
    // The case the entry is named for, and the half that catches an
    // overcorrection: a repair that only handled the inside of a table would
    // break this row first.
    const editor = openWithMenu('');

    pressInsertTable();
    editor.editor.commands.insertContent('X');

    expect(editor.getMarkdown()).toBe(NEW_TABLE);
  });

  it('still splits a paragraph around the table at the caret', () => {
    // Pinned as it is, not as it ought to be: that is not what #278 is about.
    const editor = openWithMenu('hello');
    caret('paragraph', 2)(editor);

    pressInsertTable();
    editor.editor.commands.insertContent('X');

    expect(editor.getMarkdown()).toBe(`he\n\n${NEW_TABLE}\n\nllo`);
  });

  it('makes the table the dialog asks for, bounded by the limits on its fields', () => {
    // A browser does not enforce `max` on a typed number, and the table is
    // built by a loop over both, so the dialog applies the bound itself.
    const editor = openWithMenu('');

    pressInsertTable({ rows: '999', cols: '999' });

    const table = editor.editor.state.doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(50);
    expect(table.firstChild!.childCount).toBe(20);
  });
});
