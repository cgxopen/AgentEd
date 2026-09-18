/**
 * A block inside a table cell comes back as the block it was (#300).
 *
 * **Every row asserts the node after the reload beside the bytes**, by owner
 * decision on R-C2. Bytes alone are not a witness here: on `4761475` an ordered
 * list typed into a cell was written `1. item` on both saves and came back a
 * paragraph, so a row that compared files would have passed over the loss.
 *
 * A row makes the construct by the route a person takes — an input rule typed
 * a character at a time, Enter or Shift+Enter through `handleKeyDown`, an
 * Insert entry clicked on the rendered menu — then saves, loads the saved text
 * into the same editor, saves, loads and saves again. The cell holds the same
 * nodes before the first save and after each load, the first save is the bytes
 * the row names, and the second and third saves equal it.
 *
 * Nothing here is layout, so nothing here is owed to a manual pass.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { type MenuCallbacks, setupMenu } from '../ui/menu';
import { insertMenuCallbacks } from './insert-blocks';
import { codeBlockRoutes } from './insert-code-block';
import { htmlToMarkdown } from './markdown/serialize';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/** A table whose first body cell is empty, for the routes to type into. */
const EMPTY_CELL = '| a | b |\n| --- | --- |\n|  | 2 |';

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

function shippedHeaderMarkup(): string {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  return shippedPage.slice(open, close + '</header>'.length);
}

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
    onImageDescription: vi.fn(),
    onToggleSpellcheck: vi.fn(),
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

/** `markdown` in an editor with the real menu bound over it. */
function open(markdown: string): EditorInstance {
  document.body.innerHTML = shippedHeaderMarkup();
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  const { editor } = instance;
  setupMenu(
    { ...spies(), ...insertMenuCallbacks(editor), ...codeBlockRoutes(editor) },
    () => ({ canUndo: false, canRedo: false }),
    noTableShape,
  );
  return instance;
}

/** Where the first body cell starts. */
function firstBodyCell(editor: EditorInstance): number {
  let found = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'tableCell') found = pos;
    return found < 0;
  });
  if (found < 0) throw new Error('the document has no body cell');
  return found;
}

function cellNodes(editor: EditorInstance): unknown {
  return editor.editor.state.doc.nodeAt(firstBodyCell(editor))?.toJSON().content;
}

/** Feed text the way a keypress does, so the markdown input rules run. */
function type(editor: EditorInstance, text: string): void {
  for (const character of text) {
    const { view } = editor.editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

/** A key the way the key does it, so the keymaps and the input rules see it. */
function press(editor: EditorInstance, key: string, shiftKey = false): void {
  const { view } = editor.editor;
  const event = new KeyboardEvent('keydown', { key, shiftKey });
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event));
  if (!handled) throw new Error(`nothing handled ${shiftKey ? 'Shift+' : ''}${key}`);
}

function chooseInsert(id: string): void {
  document.getElementById('menu-toggle')!.click();
  document.getElementById('menu-section-insert')!.click();
  document.getElementById(id)!.click();
}

/** The body row the table is saved with. */
const bodyRow = (markdown: string) => markdown.split('\n')[2];

interface Trip {
  readonly first: string;
  readonly saves: readonly string[];
  readonly before: unknown;
  readonly afterEachLoad: readonly unknown[];
}

/** Save, load, save, load, save — the node and the bytes at every step. */
function roundTrip(editor: EditorInstance): Trip {
  const before = cellNodes(editor);
  const saves = [editor.getMarkdown()];
  const afterEachLoad: unknown[] = [];
  for (let load = 0; load < 2; load++) {
    editor.setMarkdown(saves[saves.length - 1]);
    afterEachLoad.push(cellNodes(editor));
    saves.push(editor.getMarkdown());
  }
  return { first: saves[0], saves, before, afterEachLoad };
}

function expectKept(trip: Trip, row: string): void {
  expect(bodyRow(trip.first)).toBe(row);
  expect(trip.saves[1]).toBe(trip.first);
  expect(trip.saves[2]).toBe(trip.saves[1]);
  for (const nodes of trip.afterEachLoad) expect(nodes).toEqual(trip.before);
}

type Route = (editor: EditorInstance) => void;

/** Each member of the family, made in an empty cell by the route a person takes. */
const MEMBERS: ReadonlyArray<readonly [string, Route, string, string]> = [
  ['a heading, typed', (e) => type(e, '## Title'), '| <h2>Title</h2> | 2 |', 'heading'],
  [
    'a bullet list, typed',
    (e) => type(e, '- item'),
    '| <ul><li>item</li></ul> | 2 |',
    'bulletList',
  ],
  [
    'an ordered list, typed',
    (e) => type(e, '1. item'),
    '| <ol><li>item</li></ol> | 2 |',
    'orderedList',
  ],
  [
    'an ordered list with its start, typed',
    (e) => type(e, '3. item'),
    '| <ol start="3"><li>item</li></ol> | 2 |',
    'orderedList',
  ],
  [
    'a task list, typed',
    (e) => type(e, '[ ] task'),
    '| <ul><li><input type="checkbox"> task</li></ul> | 2 |',
    'taskList',
  ],
  [
    'a task list, ticked',
    (e) => {
      type(e, '[ ] task');
      e.editor.commands.updateAttributes('taskItem', { checked: true });
    },
    '| <ul><li><input type="checkbox" checked> task</li></ul> | 2 |',
    'taskList',
  ],
  [
    'a task list, from Insert Checklist',
    (e) => {
      chooseInsert('menu-insert-checklist');
      type(e, 'task');
    },
    '| <ul><li><input type="checkbox"> task</li></ul> | 2 |',
    'taskList',
  ],
  [
    'a blockquote, typed',
    (e) => type(e, '> quoted'),
    '| <blockquote>quoted</blockquote> | 2 |',
    'blockquote',
  ],
  [
    'a fenced block, typed, holding a star, a backtick and a pipe',
    (e) => {
      type(e, '``` ');
      type(e, 'a *b* `c` | d');
    },
    '| <pre><code>a &#42;b&#42; &#96;c&#96; \\| d</code></pre> | 2 |',
    'codeBlock',
  ],
  [
    'a fenced block with a language, typed',
    (e) => {
      type(e, '```js ');
      type(e, 'let x = 1;');
    },
    '| <pre><code class="language-js">let x = 1;</code></pre> | 2 |',
    'codeBlock',
  ],
  [
    'a fenced block, from Insert Code Block',
    (e) => {
      chooseInsert('menu-insert-code-block');
      type(e, 'let x = 1;');
    },
    '| <pre><code>let x = 1;</code></pre> | 2 |',
    'codeBlock',
  ],
  [
    'a second paragraph, by Enter',
    (e) => {
      type(e, 'one');
      press(e, 'Enter');
      type(e, 'two');
    },
    '| one<p>two</p> | 2 |',
    'paragraph',
  ],
  [
    'a hard break, by Shift+Enter',
    (e) => {
      type(e, 'one');
      press(e, 'Enter', true);
      type(e, 'two');
    },
    '| one<br>two | 2 |',
    'paragraph',
  ],
];

describe('a block made in a cell comes back as that block (#300)', () => {
  it.each(MEMBERS)('%s', (_label, route, row, nodeType) => {
    const editor = open(EMPTY_CELL);
    editor.editor.commands.setTextSelection(firstBodyCell(editor) + 2);

    route(editor);
    const trip = roundTrip(editor);

    // The route made the construct, so the rest of the row is about keeping it.
    expect(JSON.stringify(trip.before)).toContain(`"type":"${nodeType}"`);
    expectKept(trip, row);
  });

  it('keeps an ordered list that writes the same bytes with or without its node', () => {
    // The row that decides what a criterion here is allowed to be. On
    // `4761475` this cell was written `1. item` twice and read back as a
    // paragraph; the bytes held still while the list did not.
    const editor = open(EMPTY_CELL);
    editor.editor.commands.setTextSelection(firstBodyCell(editor) + 2);
    type(editor, '1. item');

    const trip = roundTrip(editor);

    for (const nodes of trip.afterEachLoad) {
      expect(JSON.stringify(nodes)).toContain('"type":"orderedList"');
      expect(JSON.stringify(nodes)).not.toContain('"text":"1. item"');
    }
  });
});

describe('what was already written in a cell is written as before (#278, #282, #93)', () => {
  it('writes a rule typed into a cell the #282 way', () => {
    const editor = open(EMPTY_CELL);
    editor.editor.commands.setTextSelection(firstBodyCell(editor) + 2);
    type(editor, '---');

    const trip = roundTrip(editor);

    expect(bodyRow(trip.first)).toBe('| <hr> | 2 |');
    expect(trip.saves[1]).toBe(trip.first);
    expect(JSON.stringify(trip.afterEachLoad[0])).toContain('"type":"horizontalRule"');
  });

  it.each([
    ['a paragraph then a rule', '| a | b |\n| --- | --- |\n| 1<hr> | 2 |'],
    [
      'a paragraph then a table',
      '| a | b |\n| --- | --- |\n| P <table><tr><td>x</td><td>y</td></tr></table> | 2 |',
    ],
    [
      'a cell of inline content only',
      '| a | b |\n| --- | --- |\n| **b** `c` [l](https://e.com) | 1. x |',
    ],
  ])('writes %s byte for byte, and keeps its nodes', (_label, markdown) => {
    const editor = open(markdown);

    const trip = roundTrip(editor);

    expect(trip.first).toBe(markdown);
    expectKept(trip, bodyRow(markdown));
  });
});

describe('a file that already holds a block in a cell opens and saves unchanged (#300)', () => {
  it.each([
    [
      'a list as inline HTML',
      '| a | b |\n| --- | --- |\n| <ul><li>one</li><li>two</li></ul> | 2 |',
    ],
    ['a heading as inline HTML', '| a | b |\n| --- | --- |\n| <h2>Title</h2> | 2 |'],
    ['two paragraphs', '| a | b |\n| --- | --- |\n| one<p>two</p> | 2 |'],
    ['a hard break', '| a | b |\n| --- | --- |\n| one<br>two | 2 |'],
    [
      'a nested table holding a list',
      '| a |\n| --- |\n| <table><tr><td><ul><li>deep</li></ul></td></tr></table> |',
    ],
    [
      'a raw HTML table holding a list, which #283 keeps',
      '<table>\n<tr><th>a</th><th>b</th></tr>\n<tr><td><ul><li>one</li><li>two</li></ul></td><td>2</td></tr>\n</table>',
    ],
  ])('%s', (_label, markdown) => {
    const editor = open(markdown);
    const loaded = cellNodes(editor);

    const trip = roundTrip(editor);

    expect(trip.first).toBe(markdown);
    expect(trip.saves[2]).toBe(markdown);
    expect(trip.before).toEqual(loaded);
    for (const nodes of trip.afterEachLoad) expect(nodes).toEqual(loaded);
  });
});

/**
 * The characters a code block writes as entities are a list, and a list leaves
 * out whatever it does not name. So the list is witnessed by a sweep: every
 * printable ASCII character, inside the code, one at a time at the start, in
 * the middle and doubled, and then all of them in one block. Characters outside
 * ASCII are not swept.
 */
describe('every printable ASCII character in a code block in a cell comes back as itself (#300)', () => {
  const PRINTABLE = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
    String.fromCharCode(0x20 + i),
  );

  function codeInCell(editor: EditorInstance, text: string, language: string | null): void {
    const { state, view } = editor.editor;
    const cell = firstBodyCell(editor);
    const node = state.doc.nodeAt(cell);
    if (!node) throw new Error('no cell');
    const code = state.schema.nodes.codeBlock.create({ language }, state.schema.text(text));
    view.dispatch(state.tr.replaceWith(cell + 1, cell + node.nodeSize - 1, code));
  }

  function returnsItself(editor: EditorInstance, text: string, language: string | null): boolean {
    editor.setMarkdown(EMPTY_CELL);
    codeInCell(editor, text, language);
    const trip = roundTrip(editor);
    return (
      trip.saves[1] === trip.first &&
      trip.saves[2] === trip.first &&
      trip.afterEachLoad.every((nodes) => JSON.stringify(nodes) === JSON.stringify(trip.before))
    );
  }

  // 95 characters in three places, each through three saves and two loads.
  it('one character at a time', { timeout: 60_000 }, () => {
    const editor = open(EMPTY_CELL);
    const failing = PRINTABLE.filter(
      (character) =>
        !['start', 'middle', 'doubled'].every((where) => {
          const text =
            where === 'start'
              ? `${character}q`
              : where === 'middle'
                ? `x${character}y`
                : `z${character}${character}z`;
          return returnsItself(editor, text, null);
        }),
    );

    expect(failing).toEqual([]);
  });

  it('all of them in one block, over two lines', () => {
    const editor = open(EMPTY_CELL);

    expect(
      returnsItself(editor, `first ${PRINTABLE.join('')}\nsecond ${PRINTABLE.join('')}`, null),
    ).toBe(true);
  });

  it('every character a language can hold, in the language', () => {
    // A language is any run of characters that is neither whitespace nor a
    // backtick (#237), so the attribute it is written into is swept too.
    const editor = open(EMPTY_CELL);
    const failing = PRINTABLE.filter((c) => c !== ' ' && c !== '`').filter(
      (character) => !returnsItself(editor, 'x', `a${character}b`),
    );

    expect(failing).toEqual([]);
  });
});

/**
 * Text a clipboard puts straight into a cell, a list item or a blockquote (#313).
 *
 * The editor never renders bare text in those containers, which is why every row
 * above reaches the serializer with a paragraph around it. **A paste does not**:
 * `cleanPastedHtml` hands the clipboard HTML to `htmlToMarkdown` before any node
 * exists, and `<li>text</li>` is how the web writes a tight list. On the first
 * head of #313 eight of these nine shapes lost their words at the paste.
 *
 * Each shape is asserted twice. **Through `htmlToMarkdown`**, which is the unit
 * the paste calls: the markdown it writes, and the cell that markdown opens as.
 * **Through the paste**, a real `ClipboardEvent` into a paragraph: the cell as it
 * lands, before any save, which is where the loss used to be visible, and then
 * saved, opened and saved again. Both assert every word of the clipboard beside
 * the nodes.
 */
describe('a clipboard that puts text straight into a container keeps every word (#313)', () => {
  const SHAPES: ReadonlyArray<readonly [string, string, string, string]> = [
    [
      'a list item holding text',
      '<ul><li>text</li></ul>',
      '<ul><li>text</li></ul>',
      '<bulletList(listItem(paragraph("text")))>',
    ],
    [
      'text, then a list',
      'intro<ul><li>a</li></ul>',
      'intro<ul><li>a</li></ul>',
      '<paragraph("intro"), bulletList(listItem(paragraph("a")))>',
    ],
    [
      'a blockquote holding text',
      '<blockquote>quoted</blockquote>',
      '<blockquote>quoted</blockquote>',
      '<blockquote(paragraph("quoted"))>',
    ],
    [
      'a list item holding text and a nested list',
      '<ul><li>one<ul><li>inner</li></ul></li></ul>',
      '<ul><li>one<ul><li>inner</li></ul></li></ul>',
      '<bulletList(listItem(paragraph("one"), bulletList(listItem(paragraph("inner")))))>',
    ],
    [
      'an ordered list of text items',
      '<ol><li>first</li><li>second</li></ol>',
      '<ol><li>first</li><li>second</li></ol>',
      '<orderedList(listItem(paragraph("first")), listItem(paragraph("second")))>',
    ],
    [
      'a blockquote holding text, then a paragraph',
      '<blockquote>q<p>r</p></blockquote>',
      '<blockquote>q<p>r</p></blockquote>',
      '<blockquote(paragraph("q"), paragraph("r"))>',
    ],
    [
      'a heading, then text',
      '<h2>Title</h2>tail text',
      '<h2>Title</h2>tail text',
      '<heading("Title"), paragraph("tail text")>',
    ],
    [
      'two paragraphs, then text',
      '<p>one</p><p>two</p>loose',
      'one<p>two</p><p>loose</p>',
      '<paragraph("one"), paragraph("two"), paragraph("loose")>',
    ],
    [
      'inline content only',
      'plain <strong>bold</strong> text',
      'plain **bold** text',
      '<paragraph("plain ", bold("bold"), " text")>',
    ],
    [
      'an indented cell, the way a web page writes one',
      '\n      lead\n      <ul>\n        <li>one</li>\n        <li>two</li>\n      </ul>\n      tail\n    ',
      'lead<ul><li>one</li><li>two</li></ul>tail',
      '<paragraph("lead"), bulletList(listItem(paragraph("one")), listItem(paragraph("two"))), paragraph("tail")>',
    ],
    [
      'text, then a paragraph',
      'lead<p>two</p>',
      'lead<p>two</p>',
      '<paragraph("lead"), paragraph("two")>',
    ],
  ];

  /** The first cell of the first table, header or body. */
  function firstCell(editor: EditorInstance): string {
    const table = editor.editor.state.doc.content.content.find(
      (node) => node.type.name === 'table',
    );
    if (!table) throw new Error('the document holds no table');
    return table.child(0).child(0).content.toString();
  }

  /** The words of a clipboard cell, as a person reads them. */
  function wordsOf(html: string): string[] {
    const holder = document.createElement('div');
    // A space before every tag, so words on either side of one stay two words.
    holder.innerHTML = html.replace(/</g, ' <');
    return (holder.textContent ?? '').match(/[A-Za-z]+/g) ?? [];
  }

  function expectWords(cellNodes: string, html: string): void {
    for (const word of wordsOf(html)) expect(cellNodes, word).toContain(word);
  }

  it.each(SHAPES)('%s, through htmlToMarkdown', (_label, cell, written, nodes) => {
    const markdown = htmlToMarkdown(`<table><tr><td>${cell}</td></tr></table>`);
    expect(markdown).toBe(`| ${written} |\n| --- |`);

    const editor = open(markdown);
    expect(firstCell(editor)).toBe(nodes);
    expectWords(firstCell(editor), cell);
    expect(editor.getMarkdown()).toBe(markdown);
  });

  it.each(SHAPES)('%s, through the paste', (_label, cell, written, nodes) => {
    const editor = open('before');
    editor.editor.commands.setTextSelection(editor.editor.state.doc.content.size - 1);
    const data = new DataTransfer();
    data.setData('text/html', `<p>x</p><table><tr><td>${cell}</td></tr></table>`);
    data.setData('text/plain', 'x');
    editor.editor.view.dom.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );

    // Before any save: this is where the words used to be gone.
    expect(firstCell(editor)).toBe(nodes);
    expectWords(firstCell(editor), cell);

    const saved = editor.getMarkdown();
    expect(saved.split('\n')).toContain(`| ${written} |`);
    editor.setMarkdown(saved);
    expect(firstCell(editor)).toBe(nodes);
    expect(editor.getMarkdown()).toBe(saved);
  });
});
