import { beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { setupMenu } from '../ui/menu';
import {
  canInsertFootnote,
  FOOTNOTE_SHORTCUT,
  footnoteAvailability,
  footnoteMenuCallbacks,
  INSERT_FOOTNOTE_KEY,
  insertFootnote,
  nextFreeLabel,
} from './insert-footnote';
import { createEditor, type EditorInstance } from './setup';

/**
 * Issue #409 — making a footnote, on the owner decisions of 2026-09-22.
 *
 * The bytes in every row are what `getMarkdown` returned after the command
 * ran, and each of them was rendered through `gh api markdown` in gfm mode on
 * the branch before it was written down: an inserted footnote renders as a
 * footnote, and a definition written at the end renders exactly as one written
 * in the middle does.
 *
 * **What is not observable here**: where the bar draws the control, whether
 * the tooltip appears under the pointer, and whether `Ctrl+Alt+F` survives
 * WebView2. The rows below drive the command, the routes and the schema; the
 * manual pass on the artifact is where the surface is verified.
 */

let editor: EditorInstance | null = null;

function open(markdown: string): EditorInstance {
  editor?.destroy?.();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  instance.setMarkdown(markdown);
  editor = instance;
  return instance;
}

/** The caret just after the first occurrence of this text. */
function caretAfter(instance: EditorInstance, text: string): void {
  const all = instance.editor.state.doc.textBetween(
    0,
    instance.editor.state.doc.content.size,
    '\n',
  );
  const at = all.indexOf(text) + 1 + text.length;
  instance.editor.commands.setTextSelection({ from: at, to: at });
}

/** The first occurrence of this text, selected. */
function select(instance: EditorInstance, text: string): void {
  const all = instance.editor.state.doc.textBetween(
    0,
    instance.editor.state.doc.content.size,
    '\n',
  );
  const from = all.indexOf(text) + 1;
  instance.editor.commands.setTextSelection({ from, to: from + text.length });
}

describe('the reference lands after the selection and the definition at the end (#409)', () => {
  it('leaves the selected words in place and writes the reference after them', () => {
    const instance = open('The margin rule applies.\n');
    select(instance, 'margin rule');
    insertFootnote(instance.editor);

    expect(instance.getMarkdown()).toBe('The margin rule[^1] applies.\n\n[^1]:');
  });

  it('writes at the caret when nothing is selected', () => {
    const instance = open('One two.\n');
    caretAfter(instance, 'One');
    insertFootnote(instance.editor);

    expect(instance.getMarkdown()).toBe('One[^1] two.\n\n[^1]:');
  });

  it('puts the caret in the new definition, so the note is typed straight away', () => {
    const instance = open('The margin rule applies.\n');
    select(instance, 'margin rule');
    insertFootnote(instance.editor);
    instance.editor.commands.insertContent('Cost Allocation Standard');

    expect(instance.getMarkdown()).toBe(
      'The margin rule[^1] applies.\n\n[^1]: Cost Allocation Standard',
    );
  });

  it('carries no mark from the text it lands after', () => {
    // `insertText` would inherit the bold at that position and write
    // `**Note[^1]**`, which spells the reference as emphasis.
    const instance = open('**Note** and more.\n');
    select(instance, 'Note');
    insertFootnote(instance.editor);

    expect(instance.getMarkdown()).toBe('**Note**[^1] and more.\n\n[^1]:');
  });

  it('is byte-identical on the second save, note and all', () => {
    const instance = open('The margin rule applies.\n');
    select(instance, 'margin rule');
    insertFootnote(instance.editor);
    instance.editor.commands.insertContent('the standard');
    const once = instance.getMarkdown();

    expect(open(once).getMarkdown()).toBe(once);
  });
});

describe('the label is the smallest free number (#409)', () => {
  it('starts at one in a document with no footnotes', () => {
    const instance = open('Text.\n');
    expect(nextFreeLabel(instance.editor.state.doc)).toBe('1');
  });

  it('takes the next one where the numbers below it are defined', () => {
    const instance = open('A.[^1] B.[^2] text.\n\n[^1]: one\n[^2]: two');
    caretAfter(instance, 'text.');
    insertFootnote(instance.editor);

    expect(instance.getMarkdown()).toBe('A.[^1] B.[^2] text.[^3]\n\n[^1]: one\n[^2]: two\n[^3]:');
  });

  it('fills the gap rather than counting the definitions', () => {
    // Two definitions, labelled 1 and 3: the free number is 2, not 3.
    const instance = open('A.[^1] B.[^3] text.\n\n[^1]: one\n[^3]: three');
    expect(nextFreeLabel(instance.editor.state.doc)).toBe('2');
  });

  it('steps over a number a reference holds with no definition behind it', () => {
    // The superset the module records: reusing `1` here would hand the orphan
    // reference above a meaning it never had, GitHub pointing every reference
    // with a label at the one definition carrying it.
    const instance = open('A.[^1] with nothing defining it.\n');
    expect(nextFreeLabel(instance.editor.state.doc)).toBe('2');
  });

  it('leaves a word label alone and picks a number beside it', () => {
    const instance = open('A.[^margin-standard] text.\n\n[^margin-standard]: the standard');
    caretAfter(instance, 'text.');
    insertFootnote(instance.editor);

    expect(instance.getMarkdown()).toBe(
      'A.[^margin-standard] text.[^1]\n\n[^margin-standard]: the standard\n[^1]:',
    );
  });
});

describe('the pair is one step of undo (R-C16, #409)', () => {
  it('one press takes both halves back', () => {
    const instance = open('The margin rule applies.\n');
    select(instance, 'margin rule');
    insertFootnote(instance.editor);
    expect(instance.getMarkdown()).toBe('The margin rule[^1] applies.\n\n[^1]:');

    instance.editor.commands.undo();

    expect(instance.getMarkdown()).toBe('The margin rule applies.');
  });

  it('and redo puts the pair back, both halves together', () => {
    const instance = open('The margin rule applies.\n');
    select(instance, 'margin rule');
    insertFootnote(instance.editor);
    instance.editor.commands.undo();
    instance.editor.commands.redo();

    expect(instance.getMarkdown()).toBe('The margin rule[^1] applies.\n\n[^1]:');
  });

  /**
   * **The reversal for this one**: writing the two halves as two commands is
   * what the step zero measured, and it leaves the reference standing after
   * one undo. Built here rather than described, so the property is the row
   * rather than the prose.
   */
  it('two commands would be two steps, which is what this shape avoids', () => {
    const instance = open('The margin rule applies.\n');
    select(instance, 'margin rule');
    const { editor: view } = instance;
    view.chain().focus().insertContentAt(view.state.selection.to, '[^1]').run();
    view
      .chain()
      .command(({ tr, state }) => {
        tr.insert(
          tr.doc.content.size,
          state.schema.nodes.footnoteDefinition.create(null, state.schema.text('[^1]: ')),
        );
        return true;
      })
      .run();

    view.commands.undo();

    expect(instance.getMarkdown()).toBe('The margin rule[^1] applies.');
  });
});

describe('deleting one half leaves the other (#409)', () => {
  it('the definition stays when the reference goes', () => {
    const instance = open('Text.[^a] more.\n\n[^a]: the note');
    const all = instance.editor.state.doc.textBetween(
      0,
      instance.editor.state.doc.content.size,
      '\n',
    );
    const from = all.indexOf('[^a]') + 1;
    instance.editor
      .chain()
      .setTextSelection({ from, to: from + 4 })
      .deleteSelection()
      .run();

    expect(instance.getMarkdown()).toBe('Text. more.\n\n[^a]: the note');
  });

  it('the reference stays when the definition goes', () => {
    const instance = open('Text.[^a] more.\n\n[^a]: the note');
    let at = -1;
    let size = 0;
    instance.editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'footnoteDefinition') return true;
      at = pos;
      size = node.nodeSize;
      return false;
    });
    instance.editor
      .chain()
      .command(({ tr }) => {
        tr.delete(at, at + size);
        return true;
      })
      .run();

    expect(instance.getMarkdown()).toBe('Text.[^a] more.');
  });
});

describe('the gap a new definition lands in (#418 attribute, #409 insert)', () => {
  it('joins a run that ends the file on the next line', () => {
    const instance = open('A.[^1] text.\n\n[^1]: one\n');
    caretAfter(instance, 'text.');
    insertFootnote(instance.editor);

    expect(instance.getMarkdown()).toBe('A.[^1] text.[^2]\n\n[^1]: one\n[^2]:');
  });

  it('leaves the gaps the file spelled inside the run exactly as they were', () => {
    const instance = open('A.[^1] B.[^2] text.\n\n[^1]: one\n\n[^2]: two');
    caretAfter(instance, 'text.');
    insertFootnote(instance.editor);
    const once = instance.getMarkdown();

    expect(once).toBe('A.[^1] B.[^2] text.[^3]\n\n[^1]: one\n\n[^2]: two\n[^3]:');
    expect(open(once).getMarkdown()).toBe(once);
  });
});

describe('where the footnote control cannot act (#409)', () => {
  it('refuses inside a fenced block', () => {
    const instance = open('```\ncode here\n```\n');
    instance.editor.commands.setTextSelection({ from: 3, to: 3 });

    expect(canInsertFootnote(instance.editor)).toBe(false);
    expect(footnoteAvailability(instance.editor)[INSERT_FOOTNOTE_KEY]).toBe(false);
  });

  it('refuses inside a definition, where the caret lands after a load', () => {
    const instance = open('A.[^1]\n\n[^1]: one\n');
    const end = instance.editor.state.doc.content.size - 2;
    instance.editor.commands.setTextSelection({ from: end, to: end });

    expect(canInsertFootnote(instance.editor)).toBe(false);
  });

  it('allows it in ordinary text', () => {
    const instance = open('Text here.\n');
    caretAfter(instance, 'Text');

    expect(canInsertFootnote(instance.editor)).toBe(true);
    expect(footnoteAvailability(instance.editor)[INSERT_FOOTNOTE_KEY]).toBe(true);
  });
});

describe('the routes reach the one command (#409)', () => {
  /** The header alone, which is where the menu markup lives (#266 shape). */
  function shippedHeaderMarkup(): string {
    const open = shippedPage.indexOf('<header id="menubar">');
    const close = shippedPage.indexOf('</header>');
    if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
    return shippedPage.slice(open, close + '</header>'.length);
  }

  beforeEach(() => {
    document.body.innerHTML = shippedHeaderMarkup();
  });

  it('the Insert entry runs the insert on the editor it was built for', () => {
    const instance = open('Text here.\n');
    caretAfter(instance, 'Text');
    const callbacks = {
      onNew: vi.fn(),
      onNewFromTemplate: vi.fn(),
      onOpen: vi.fn(),
      onOpenRecentFile: vi.fn(),
      onClearRecentFiles: vi.fn(),
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
      onToggleSpellcheck: vi.fn(),
      onAddRowAbove: vi.fn(),
      onAddRowBelow: vi.fn(),
      onDeleteRow: vi.fn(),
      onAddColumnBefore: vi.fn(),
      onAddColumnAfter: vi.fn(),
      onDeleteColumn: vi.fn(),
      onDeleteTable: vi.fn(),
      onTableShapeColumn: vi.fn(),
      onTableShapeTable: vi.fn(),
      onAbout: vi.fn(),
      ...footnoteMenuCallbacks(instance.editor),
    };
    setupMenu(
      callbacks,
      () => ({ canUndo: false, canRedo: false }),
      () => footnoteAvailability(instance.editor),
    );

    document.getElementById('menu-insert-footnote')?.click();

    expect(instance.getMarkdown()).toBe('Text[^1] here.\n\n[^1]:');
  });

  it('the entry is greyed where the command would do nothing', () => {
    const instance = open('```\ncode here\n```\n');
    instance.editor.commands.setTextSelection({ from: 3, to: 3 });
    const noop = new Proxy({}, { get: () => vi.fn() }) as unknown as Parameters<
      typeof setupMenu
    >[0];
    setupMenu(
      noop,
      () => ({ canUndo: false, canRedo: false }),
      () => footnoteAvailability(instance.editor),
    );

    document.getElementById('menu-toggle')?.click();

    expect(document.querySelector<HTMLButtonElement>('#menu-insert-footnote')?.disabled).toBe(true);
  });

  it('the chord, driven on the editor rather than read from the source', () => {
    const instance = open('Text here.\n');
    caretAfter(instance, 'Text');

    instance.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'f',
        code: 'KeyF',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(instance.getMarkdown()).toBe('Text[^1] here.\n\n[^1]:');
  });

  it('the chord names the same keys the menu entry shows', () => {
    expect(FOOTNOTE_SHORTCUT.chord).toBe('Ctrl+Alt+F');
    expect(FOOTNOTE_SHORTCUT.binding).toBe('Mod-Alt-f');
  });
});
