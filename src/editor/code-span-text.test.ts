import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipboardSerializerWithToken } from './clipboard-token';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * The text of a code span reaches the file as written, white space included
 * (#603). See `code-span-spacing.ts` for the parse and the space around a
 * span, and `markdown/code-span-spaces.ts` for a span of spaces only.
 */

let instances: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.innerHTML = '';
});

function paste(instance: EditorInstance, clipboard: { text?: string; html?: string }): void {
  const data: Record<string, string> = {};
  if (clipboard.text !== undefined) data['text/plain'] = clipboard.text;
  if (clipboard.html !== undefined) data['text/html'] = clipboard.html;
  const event = {
    clipboardData: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
      files: [],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = instance.editor;
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

/** The position just after the last character of `text` in the document. */
function positionAfter(instance: EditorInstance, text: string): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text) + text.length;
    }
  });
  if (found === -1) throw new Error(`no ${text} in the document`);
  return found;
}

/** A line of inline content in each of the five places it can stand. */
function inEachPlace(line: string): Array<[string, string]> {
  return [
    ['in a paragraph', line],
    ['in a heading', `## ${line}`],
    ['in a list item', `- ${line}`],
    ['in a quote', `> ${line}`],
    ['in a table cell', `| ${line} |\n| --- |`],
  ];
}

const NBSP = String.fromCharCode(0xa0);

/** Each shape a file writes, read by GitHub as the span the file wrote. */
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['a span of one space', 'a ` ` b'],
  ['a span of two spaces (example 138)', 'a `  ` b'],
  ['a run inside a span', 'a `x  y` b'],
  ['a tab inside a span', 'a `x\ty` b'],
  ['padding on both sides', 'a `  x  ` b'],
  ['a leading space alone', 'a ` x` b'],
  ['a trailing space alone', 'a `x ` b'],
  ['a span ending in a space before a space, the stop of the step zero', 'the `name ` of x'],
  ['a span at the end of a block with trailing padding (331, 336)', 'end `a `'],
  ['a block holding only a span of white space (334)', '`  `'],
  ['a padding of non-breaking spaces (333)', `a \`${NBSP}b${NBSP}\` c`],
];

describe('the text of a code span is written as the file holds it (#603)', () => {
  describe.each(SHAPES)('%s', (_label, line) => {
    it.each(inEachPlace(line))('%s', (_place, markdown) => {
      expect(editorWith(markdown).getMarkdown()).toBe(markdown);
    });
  });

  it.each([
    // A line break inside a span is one space to CommonMark, and the span is
    // written on one line with the spaces it holds (examples 335, 337, 640).
    ['a line break inside a span', 'a `foo\nbar` b', 'a `foo bar` b'],
    ['a line break after a run inside a span', '`code  \nspan`', '`code   span`'],
    ['a line break before a trailing space', '``\nfoo \n``', '`foo `'],
  ])('%s is written as the spaces GitHub reads there', (_label, markdown, written) => {
    expect(editorWith(markdown).getMarkdown()).toBe(written);
  });
});

describe('code that is not a span (#603)', () => {
  it.each([
    ['a fence holding a run and a tab', '```\na  b\tc\n```'],
    ['a fence in a quote holding a tab', '> ```\n> a  b\tc\n> ```'],
  ])('%s is written as before', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });

  it('a tab in code in a list item is written as four spaces, as marked reads it', () => {
    expect(editorWith('- x\n\n  ```\n  a\tb\n  ```').getMarkdown()).toBe(
      '- x\n\n  ```\n  a    b\n  ```',
    );
  });
});

describe('a code span through an edit and a paste (#603)', () => {
  it('a run in a span is drawn as a run', () => {
    const editor = editorWith('a `x  y` b');
    expect(document.querySelector('code')?.textContent).toBe('x  y');
    expect(editor.getMarkdown()).toBe('a `x  y` b');
  });

  it('two spaces typed inside a span are written as two', () => {
    const editor = editorWith('a `xy` b');
    editor.editor.chain().setTextSelection(positionAfter(editor, 'x')).insertContent('  ').run();
    expect(editor.getMarkdown()).toBe('a `x  y` b');
  });

  it('Enter inside a span with padding splits it into two paragraphs', () => {
    // Two spaces each side, so the span holds one each side once CommonMark
    // strips the pair it reads as padding.
    const editor = editorWith('a `  xy  ` b');
    editor.editor.chain().setTextSelection(positionAfter(editor, ' x')).splitBlock().run();
    expect(editor.getMarkdown()).toBe('a ` x`\n\n`y ` b');
  });

  it('an HTML paste of a span holding a run keeps the run', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, { html: '<p>p <code>x  y</code> q</p>' });
    expect(editor.getMarkdown()).toBe('p `x  y` qstart');
  });

  it('an HTML paste of a span ending in a space before a space loses the space after it', () => {
    // A paste goes through the DOM parser of ProseMirror and not through the
    // load, so the space the parser drops after the span is not put back.
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, { html: '<p>the <code>name </code> of x</p>' });
    expect(editor.getMarkdown()).toBe('the `name `of xstart');
  });

  it('a plain-text paste of markdown holding a span keeps the run', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, { text: 'a `x  y` b ' });
    expect(editor.getMarkdown()).toBe('a `x  y` b start');
  });

  it('a copy and paste inside one window keeps the run', () => {
    const editor = editorWith('a `x  y` b\n\nEnd.');
    const { view } = editor.editor;
    const from = positionAfter(editor, 'a ');
    editor.editor.commands.setTextSelection({ from, to: from + 4 });
    const slice = view.state.selection.content();
    const dom = document.createElement('div');
    dom.appendChild(
      clipboardSerializerWithToken(view.state.schema).serializeFragment(slice.content),
    );
    dom.firstElementChild?.setAttribute('data-pm-slice', `${slice.openStart} ${slice.openEnd} []`);
    editor.editor.commands.setTextSelection(positionAfter(editor, 'End.'));
    view.pasteHTML(dom.innerHTML);
    expect(editor.getMarkdown()).toBe('a `x  y` b\n\nEnd.`x  y`');
  });
});
