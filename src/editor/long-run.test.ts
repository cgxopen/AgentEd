import { afterEach, describe, expect, it } from 'vitest';
import { LONG_RUN, longRunDecorations, longRunKey } from './long-run';
import { createEditor, type EditorInstance } from './setup';

/**
 * #618: the long runs of a table cell carry a class, and nothing reaches the
 * file. Whether the class wraps is a layout question, measured in Chromium on
 * the pull request; what is checked here is which runs carry it, and that the
 * set kept per transaction is the set a whole walk finds.
 */

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

function open(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** The decorated runs, as the text they cover. */
function marked(editor: EditorInstance): string[] {
  const { state } = editor.editor;
  return (longRunKey.getState(state)?.find() ?? []).map((d) => state.doc.textBetween(d.from, d.to));
}

/** The kept set and a whole walk agree, range for range. */
function agrees(editor: EditorInstance): void {
  const { state } = editor.editor;
  const kept = (longRunKey.getState(state)?.find() ?? []).map((d) => [d.from, d.to]);
  const walked = longRunDecorations(state.doc)
    .find()
    .map((d) => [d.from, d.to]);
  expect(kept).toEqual(walked);
}

const URL = `https://example.com/${'a'.repeat(60)}`;
const TABLE = `| Name | Value |\n| --- | --- |\n| short | see ${URL} end |\n| code | \`${'x'.repeat(40)}\` |\n`;

describe('which runs carry the class', () => {
  it('a long run in a cell, bare, linked or in code, and nothing else', () => {
    const editor = open(
      `${TABLE}\n| a | [${URL}](${URL}) |\n| --- | --- |\n| b | ${'y'.repeat(LONG_RUN - 1)} |\n\n${URL}\n`,
    );
    expect(marked(editor)).toEqual([URL, 'x'.repeat(40), URL]);
  });

  it('a run across marks is one run', () => {
    const editor = open(`| a |\n| --- |\n| ${'p'.repeat(20)}**${'q'.repeat(20)}** |\n`);
    expect(marked(editor)).toEqual([`${'p'.repeat(20)}${'q'.repeat(20)}`]);
  });

  it('nothing reaches the file', () => {
    const editor = open(TABLE);
    expect(editor.getMarkdown()).toBe(TABLE.trimEnd());
  });
});

describe('the set kept per transaction is the set a whole walk finds', () => {
  it('through typing, deleting, splitting a run, and adding a row', () => {
    const editor = open(TABLE);
    const { editor: ed } = editor;
    const end = (text: string) => {
      let at = -1;
      ed.state.doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes(text))
          at = pos + node.text.indexOf(text) + text.length;
      });
      return at;
    };
    agrees(editor);
    // A short run grown long, one keystroke at a time.
    for (let i = 0; i < LONG_RUN; i += 1) ed.commands.insertContentAt(end('short'), 'z');
    agrees(editor);
    expect(marked(editor)).toContain(`short${'z'.repeat(LONG_RUN)}`);
    // A long run cut by a space.
    ed.commands.insertContentAt(end('example.com/'), ' ');
    agrees(editor);
    // Deleting across a whole cell.
    const at = end('see ');
    ed.commands.deleteRange({ from: at, to: at + 30 });
    agrees(editor);
    // A row added.
    ed.commands.setTextSelection(end('end'));
    ed.commands.addRowAfter();
    ed.commands.insertContent(URL);
    agrees(editor);
    // The whole document replaced.
    editor.setMarkdown(`| a |\n| --- |\n| ${URL} |\n`);
    agrees(editor);
    expect(marked(editor)).toEqual([URL]);
  });
});
