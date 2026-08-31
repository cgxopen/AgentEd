/**
 * A multi-cell selection reads the same in every cell it covers (#16).
 *
 * ── What this harness can and cannot see, stated first ──
 *
 * The property is paint, which is the third time in three days. `matches`
 * and class lists are DOM queries and happy-dom answers them; a colour on
 * a screen it cannot. Two links of the chain are measurable here and two
 * are not, and the two that are not are named rather than implied:
 *
 *  - **measured**: the selection is a `CellSelection`, it declares itself
 *    invisible, and every cell in the range carries `.selectedCell`;
 *  - **measured**: the stylesheet now carries the rules that give
 *    `ProseMirror-hideselection` a meaning, and the selector reaches the
 *    element the editor rendered;
 *  - **not measurable**: that `prosemirror-view` puts the class on the
 *    editable element in the running application. It does that from
 *    `selectionToDOM`, which happy-dom never reaches because
 *    `view.hasFocus()` stays false here even after `commands.focus()`;
 *  - **not measurable**: that the native paint is gone and the cells look
 *    alike. That is the manual pass, and the pull request says so without
 *    softening it.
 *
 * The join between the two measurable halves is the #211 shape: the
 * selector is read out of `styles.css`, never restated, and then run
 * against elements the editor actually rendered.
 */

import { CellSelection } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stylesCss from '../styles.css?raw';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const TABLE = ['| a | b | c |', '| --- | --- | --- |', '| 1 | 2 | 3 |', '| 4 | 5 | 6 |'].join('\n');

let instance: EditorInstance | null = null;

function open(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
  for (const sheet of document.head.querySelectorAll('style')) {
    sheet.remove();
  }
});

/** Where every cell of the document starts, in document order. */
function cellPositions(editor: EditorInstance): number[] {
  const positions: number[] = [];
  editor.editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') positions.push(pos);
    return true;
  });
  return positions;
}

/** Select from one cell to another, the way a drag across them does. */
function selectCells(editor: EditorInstance, from: number, to: number): void {
  const cells = cellPositions(editor);
  const done = editor.editor.commands.setCellSelection({
    anchorCell: cells[from],
    headCell: cells[to],
  });
  if (!done) throw new Error('the editor refused to make a cell selection');
}

/**
 * Select the text inside one cell, the way a drag that stays put does.
 * The cell position itself holds no inline content, so the range is taken
 * across the paragraph inside it.
 */
function selectTextInCell(editor: EditorInstance, index: number): void {
  const cell = cellPositions(editor)[index];
  const node = editor.editor.state.doc.nodeAt(cell);
  if (!node) throw new Error('no cell at that index');
  // cell start, then into its paragraph, then across the text it holds.
  const from = cell + 2;
  editor.editor.commands.setTextSelection({ from, to: from + node.textContent.length });
}

/** The text of every cell the editor has marked as selected. */
function markedCells(editor: EditorInstance): string[] {
  return Array.from(editor.editor.view.dom.querySelectorAll('.selectedCell')).map(
    (cell) => cell.textContent ?? '',
  );
}

/**
 * Every rule in `styles.css`, as a selector and the declarations under it.
 * The body is what follows the opening brace, so a comment written above a
 * rule belongs to neither half and cannot be mistaken for a declaration.
 */
function allRules(): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  for (const block of stylesCss.split('}')) {
    const brace = block.lastIndexOf('{');
    if (brace === -1) continue;
    const selector =
      block
        .slice(0, brace)
        .split('\n')
        .filter((line) => line.trim() !== '')
        .pop() ?? '';
    rules.push({ selector: selector.trim(), body: block.slice(brace + 1) });
  }
  return rules;
}

/**
 * Every rule that hides a selection or the caret. Three other rules in the
 * sheet paint a background transparent — a toolbar toggle and two sidebar
 * rows — and none of them is about a selection, so the test is what a rule
 * is aimed at rather than the word it uses.
 */
function selectionSuppressions(): Array<{ selector: string; body: string }> {
  return allRules().filter(
    (rule) =>
      rule.selector.includes('::selection') || rule.body.includes('caret-color: transparent'),
  );
}

/**
 * A rule from `styles.css`, found by a declaration it carries rather than
 * by its selector — so the selector this file asserts on is the one the
 * stylesheet has, not one repeated here.
 */
function ruleContaining(
  declaration: string,
  mustAlsoHave = '',
): { selector: string; body: string } {
  const block = stylesCss
    .split('}')
    .find((candidate) => candidate.includes(declaration) && candidate.includes(mustAlsoHave));
  if (!block) throw new Error(`styles.css carries no rule declaring ${declaration}`);
  const brace = block.lastIndexOf('{');
  const selector =
    block
      .slice(0, brace)
      .split('\n')
      .filter((line) => line.trim() !== '')
      .pop() ?? '';
  return { selector: selector.trim(), body: block.slice(brace + 1) };
}

describe('what the editor marks when several cells are selected', () => {
  it('makes a cell selection, and one that declares itself invisible', () => {
    const editor = open(TABLE);
    selectCells(editor, 3, 5);

    const selection = editor.editor.state.selection;
    expect(selection).toBeInstanceOf(CellSelection);
    // The reason the browser was painting its own highlight underneath:
    // `prosemirror-view` reads exactly this to decide whether to hide the
    // native selection, and the rules that made it mean anything were
    // missing from this stylesheet.
    expect((selection as unknown as { visible: boolean }).visible).toBe(false);
  });

  it('marks every cell of the range, not only the one the drag ended in', () => {
    const editor = open(TABLE);
    selectCells(editor, 3, 5);
    expect(markedCells(editor)).toEqual(['1', '2', '3']);
  });

  it('marks a whole column', () => {
    const editor = open(TABLE);
    // First header cell down to the last cell of the same column.
    selectCells(editor, 0, 6);
    expect(markedCells(editor)).toEqual(['a', '1', '4']);
  });

  it('marks the whole table, header cells included', () => {
    const editor = open(TABLE);
    selectCells(editor, 0, 8);
    expect(markedCells(editor)).toEqual(['a', 'b', 'c', '1', '2', '3', '4', '5', '6']);

    // The shape this was reported in: the header row is bold and on its own
    // background, and it has to be marked like any other cell.
    const tags = Array.from(editor.editor.view.dom.querySelectorAll('.selectedCell')).map(
      (cell) => cell.tagName,
    );
    expect(tags.slice(0, 3)).toEqual(['TH', 'TH', 'TH']);
  });

  it('marks nothing when the selection is text inside a single cell', () => {
    const editor = open(TABLE);
    selectTextInCell(editor, 3);
    expect(editor.editor.state.selection).not.toBeInstanceOf(CellSelection);
    expect(markedCells(editor)).toEqual([]);
  });
});

describe('the rules that suppress the native paint', () => {
  it('are in the stylesheet, keyed on the class prosemirror-view sets', () => {
    const { selector, body } = ruleContaining('background: transparent', '::selection');
    expect(selector).toBe('.tiptap.ProseMirror-hideselection *::selection');
    expect(body).toContain('background: transparent');
  });

  it('take the caret with them, so nothing blinks in a cell nobody is typing in', () => {
    const { selector, body } = ruleContaining('caret-color: transparent');
    expect(selector).toBe('.tiptap.ProseMirror-hideselection');
    expect(body).toContain('caret-color: transparent');
  });

  it('reach the editable element the editor renders, once the class is on it', () => {
    // The join, and the half that cannot be driven end to end: happy-dom
    // never gives the view focus, so `selectionToDOM` never runs and the
    // class never lands on its own. The class is put on by hand here and
    // the selector out of `styles.css` is run against the element, which
    // shows the rule would reach it. That the class arrives in the running
    // application is the manual pass.
    const editor = open(TABLE);
    const dom = editor.editor.view.dom;
    selectCells(editor, 3, 5);

    expect(dom.classList.contains('ProseMirror-hideselection')).toBe(false);
    dom.classList.add('ProseMirror-hideselection');

    const { selector } = ruleContaining('caret-color: transparent');
    expect(dom.matches(selector)).toBe(true);
  });

  it('leave a text selection inside one cell alone', () => {
    // Criterion 2, and the half a wider suppression breaks. A text
    // selection is visible, so ProseMirror never adds the class and the
    // native highlight is the only thing drawing it. The only way that can
    // break is a suppression written without the gate.
    //
    // So this asks of **every** selection suppression the stylesheet
    // carries, not only the one this change added: each has to be keyed on
    // the class. A build that carries none passes here, and that is what
    // keeps this independent of the tests above — those go red when the
    // rules are missing, this one when they are too wide.
    const ungated = selectionSuppressions().filter(
      (rule) => !rule.selector.includes('ProseMirror-hideselection'),
    );
    expect(ungated.map((rule) => rule.selector)).toEqual([]);
  });

  it('suppress nothing outside the editor surface', () => {
    for (const rule of selectionSuppressions()) {
      expect(rule.selector.startsWith('.tiptap')).toBe(true);
    }
  });
});

describe('the fill carries the message on its own', () => {
  it('is the only consumer of the token, so nothing else moves with it', () => {
    const consumers = stylesCss
      .split('\n')
      .filter((line) => line.includes('var(--selection-accent)'));
    expect(consumers).toHaveLength(1);
    expect(ruleContaining('var(--selection-accent)').selector).toBe('.tiptap table .selectedCell');
  });

  it('is strong enough in every shipped palette to be seen without the native paint', () => {
    // Measured rather than eyeballed: each alpha is the one that puts the
    // filled cell at about 1.60 against the ground it sits on. Before this
    // they ran from 0.10 to 0.18, which was a supporting tint beside a paint
    // that is now gone.
    const alphas = Array.from(
      stylesCss.matchAll(/--selection-accent:\s*rgba\([^)]*,\s*([\d.]+)\)/g),
      (match) => Number(match[1]),
    );
    // Seven palettes ship: light, dark, claude, solarized in both modes and
    // github in both. A palette added without a value of its own would fall
    // back to the light one and read wrong, so the count is pinned too.
    expect(alphas).toHaveLength(7);
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0.26);
    }
  });
});

describe('what already works over a multi-cell selection, unchanged', () => {
  // The issue says these work today, and they are the only thing this
  // change could break. Pinned on the markdown that would be saved, so a
  // regression shows up as the document the user would get.
  it('deleting clears every selected cell', () => {
    const editor = open(TABLE);
    selectCells(editor, 3, 5);
    editor.editor.commands.deleteSelection();

    expect(editor.getMarkdown()).toBe(
      '| a | b | c |\n| --- | --- | --- |\n|  |  |  |\n| 4 | 5 | 6 |',
    );
  });

  it('formatting applies across every selected cell', () => {
    const editor = open(TABLE);
    selectCells(editor, 3, 5);
    editor.editor.commands.toggleBold();

    expect(editor.getMarkdown()).toBe(
      '| a | b | c |\n| --- | --- | --- |\n| **1** | **2** | **3** |\n| 4 | 5 | 6 |',
    );
  });

  it('pasting replaces the selected cells', () => {
    const editor = open(TABLE);
    selectCells(editor, 3, 5);

    const data: Record<string, string> = { 'text/plain': 'PASTED' };
    const event = {
      clipboardData: {
        types: Object.keys(data),
        getData: (type: string) => data[type] ?? '',
        files: [],
      },
      preventDefault: () => undefined,
    } as unknown as ClipboardEvent;
    const { view } = editor.editor;
    const handled = view.someProp('handlePaste', (handler) =>
      handler(view, event, view.state.selection.content()),
    );

    expect(handled).toBe(true);
    // Measured on this build rather than assumed: the paste clears all
    // three cells and the text lands in the last of them. That is what it
    // does today, and this change must not move it.
    expect(editor.getMarkdown()).toBe(
      '| a | b | c |\n| --- | --- | --- |\n|  |  | PASTED |\n| 4 | 5 | 6 |',
    );
  });
});

describe('nothing about the selection reaches the file (R-C2)', () => {
  it('saves a table with cells selected byte for byte', () => {
    const editor = open(TABLE);
    selectCells(editor, 0, 8);
    expect(markedCells(editor)).toHaveLength(9);

    // `.selectedCell` is written by the table plugin as a decoration and the
    // fill is a stylesheet rule, so neither exists in the document the
    // serializer is handed. Asserted on its output all the same.
    expect(editor.getMarkdown()).toBe(TABLE);
  });

  it('writes no selection class into the markdown', () => {
    const editor = open(TABLE);
    selectCells(editor, 3, 5);
    const markdown = editor.getMarkdown();

    expect(markdown).not.toContain('selectedCell');
    expect(markdown).not.toContain('hideselection');
  });
});
