/**
 * Issue #311, half one — content the table handler cannot read as cells,
 * pasted over a selection of cells.
 *
 * **This is state rather than layout, so the harness sees all of it.** A paste
 * is a document change: every row below dispatches a real `ClipboardEvent` at
 * the editor and asserts the cells the document holds afterwards, and the
 * markdown a save would write. Nothing here is owed to a manual pass except
 * the look of it.
 *
 * **What the rows have to be able to see, and the reason they are shaped this
 * way.** The rule this replaces was **anchor against head** — the content
 * landed in the cell where the drag *ended*, so the same two cells dragged the
 * other way gave the mirror result. A row written only on a left-to-right
 * two-cell selection cannot tell the new behaviour from the old one at all:
 * both put the content in one of the two cells and empty the other. So every
 * shape below is asserted **in both directions**, and the three-cell and
 * two-by-two shapes are here because that is where the old rule emptied two
 * and three cells rather than one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const editors: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const instance = createEditor(element);
  instance.setMarkdown(markdown);
  editors.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy();
  document.body.innerHTML = '';
});

/**
 * A paste dispatched as a real `ClipboardEvent`, so every handler resolves as
 * it does in the application — the table extension included, which is what
 * decides whether a clipboard is read as cells at all.
 */
function paste(instance: EditorInstance, text: string, forcePlain = false): void {
  if (forcePlain) {
    instance.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'V',
        code: 'KeyV',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
  }
  const data = new DataTransfer();
  data.setData('text/plain', text);
  instance.editor.view.dom.dispatchEvent(
    new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    } as ClipboardEventInit),
  );
}

/** Three columns, one alignment each, so a cell that changes column shows it. */
const ALIGNED_TABLE = [
  '| h1 | h2 | h3 |',
  '| :--- | :---: | ---: |',
  '| a1 | a2 | a3 |',
  '| b1 | b2 | b3 |',
].join('\n');

/**
 * A heading beside a table: the shape a drag across a web page produces, and
 * the one the table handler declines because its top level is not cells.
 */
const MIXED = '## T\n\n| x | y |\n| --- | --- |\n| 1 | 2 |';

/** Every cell of the fixture in document order: 0..2 header, 3..5 row a, 6..8 row b. */
function cellPositions(instance: EditorInstance): number[] {
  const positions: number[] = [];
  instance.editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') positions.push(pos);
    return true;
  });
  return positions;
}

/** The text of the six body cells, in document order. */
function bodyCells(instance: EditorInstance): string[] {
  const texts: string[] = [];
  instance.editor.state.doc.descendants((node) => {
    if (node.type.name !== 'tableCell') return true;
    texts.push(node.textContent);
    return false;
  });
  return texts;
}

function selectCells(instance: EditorInstance, anchor: number, head: number): void {
  const cells = cellPositions(instance);
  const made = instance.editor.commands.setCellSelection({
    anchorCell: cells[anchor],
    headCell: cells[head],
  });
  if (!made) throw new Error('the editor refused to make a cell selection');
}

/** What the pasted clipboard reads as once it is in a cell. */
const PASTED = 'Txy12';

/**
 * The three shapes, each named by the two cells a drag runs between. The
 * indices are into the cell list above; `emptied` names the body cells that
 * must come back holding nothing.
 */
const SHAPES = [
  { name: 'two cells of one row', from: 3, to: 4, first: 0, emptied: [1] },
  { name: 'three cells of one row', from: 3, to: 5, first: 0, emptied: [1, 2] },
  { name: 'a two-by-two block', from: 3, to: 7, first: 0, emptied: [1, 3, 4] },
] as const;

describe('a paste over selected cells lands in the first of them (#311)', () => {
  for (const shape of SHAPES) {
    for (const [direction, anchor, head] of [
      ['dragged forwards', shape.from, shape.to],
      ['dragged backwards', shape.to, shape.from],
    ] as const) {
      it(`${shape.name}, ${direction}`, () => {
        const instance = editorWith(ALIGNED_TABLE);
        selectCells(instance, anchor, head);
        paste(instance, MIXED);

        const cells = bodyCells(instance);
        expect(cells[shape.first]).toBe(PASTED);
        for (const index of shape.emptied) expect(cells[index]).toBe('');
      });
    }
  }

  /**
   * The row the old rule could not pass, and the reason the two directions are
   * asserted separately above: before this change the same two cells dragged
   * the other way put the content in the other cell.
   */
  it('the direction the drag ran makes no difference at all', () => {
    const forwards = editorWith(ALIGNED_TABLE);
    selectCells(forwards, 3, 4);
    paste(forwards, MIXED);

    const backwards = editorWith(ALIGNED_TABLE);
    selectCells(backwards, 4, 3);
    paste(backwards, MIXED);

    expect(bodyCells(backwards)).toEqual(bodyCells(forwards));
    expect(backwards.getMarkdown()).toBe(forwards.getMarkdown());
  });

  it('cells outside the selection are untouched', () => {
    const instance = editorWith(ALIGNED_TABLE);
    selectCells(instance, 3, 4);
    paste(instance, MIXED);

    const cells = bodyCells(instance);
    expect(cells[2]).toBe('a3');
    expect(cells.slice(3)).toEqual(['b1', 'b2', 'b3']);
  });

  it('what it leaves behind reads back and holds still', () => {
    const instance = editorWith(ALIGNED_TABLE);
    selectCells(instance, 3, 7);
    paste(instance, MIXED);
    const saved = instance.getMarkdown().trim();

    const reopened = editorWith(saved);
    expect(reopened.getMarkdown().trim()).toBe(saved);
  });

  it('one undo puts the table back as it was', () => {
    const instance = editorWith(ALIGNED_TABLE);
    selectCells(instance, 3, 7);
    paste(instance, MIXED);
    expect(instance.editor.commands.undo()).toBe(true);
    expect(instance.getMarkdown().trim()).toBe(ALIGNED_TABLE);
  });

  /**
   * The other half of #311 keeps the behaviour it had — owner decision of
   * 2026-09-17, candidate (e). This row is here so that changing half one can
   * never quietly move half two: a caret in a cell still takes the whole of a
   * mixed clipboard into that cell.
   */
  it('a caret in one cell is not touched by any of this', () => {
    const instance = editorWith(ALIGNED_TABLE);
    let caret = -1;
    instance.editor.state.doc.descendants((node, pos) => {
      if (caret >= 0 || !node.isText || node.text !== 'a2') return caret < 0;
      caret = pos + 2;
      return false;
    });
    instance.editor.commands.setTextSelection(caret);
    paste(instance, MIXED);

    const cells = bodyCells(instance);
    expect(cells[0]).toBe('a1');
    expect(cells[1]).toBe(`a2${PASTED}`);
    expect(cells[2]).toBe('a3');
  });

  /**
   * A clipboard the handler *can* read as cells never reaches this path: it
   * overwrites from the first selected cell and grows the table at its right
   * edge, which is the #293 behaviour and is not what this issue changed.
   */
  it('a clipboard that is cells still goes to the table handler', () => {
    const instance = editorWith(ALIGNED_TABLE);
    selectCells(instance, 3, 4);
    paste(instance, '| x | y |\n| --- | --- |\n| 1 | 2 |');

    // Asserted on the markdown rather than on the cell list: a pasted table
    // arrives with header cells, which is the #299 debt and no part of this,
    // and a list of body cells alone would silently skip them.
    const row = instance.getMarkdown().trim().split('\n')[2];
    expect(row).toContain('x');
    expect(row).toContain('y');
    expect(row).toContain('a3');
  });

  it('Ctrl+Shift+V over the same selection inserts the characters', () => {
    const instance = editorWith(ALIGNED_TABLE);
    selectCells(instance, 3, 4);
    paste(instance, MIXED, true);

    expect(bodyCells(instance)[0]).toContain('##');
  });
});
