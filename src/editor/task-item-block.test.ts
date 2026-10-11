/**
 * The checkbox, when a task item's first child is not a paragraph (#157).
 *
 * The bytes are pinned in `roundtrip.test.ts`; this is the half a round-trip
 * table cannot see. Widening `taskItem` to `block+` lets a heading, a list or
 * a fence be the item's **first** child, and the question that asks — the one
 * `listItem` never had to answer in #110 — is where the checkbox goes when the
 * first block is not a paragraph, whether it is still the thing the user
 * clicks, and whether the tick survives the round trip in both states.
 *
 * The answer is structural rather than lucky: `renderHTML` and the node view
 * both build the item as `<li><label>…checkbox…</label><div>…content…</div>`,
 * so the label is a **sibling** of the content and not part of its first
 * block. These assert it on the rendered DOM rather than on that reading.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
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
});

/**
 * The rendered checkbox of the first task item, as the user meets it.
 *
 * Selected from `ul[data-type="taskList"]` rather than from the item: the node
 * view builds the `<li>` itself and writes only `data-checked` on it, so the
 * `data-type="taskItem"` that `renderHTML` emits — and that `getHTML` and the
 * serializer read — is not in the live DOM at all. Measured, not assumed; the
 * two spellings of the same item are one of the reasons this file exists.
 */
function checkboxOf(editor: EditorInstance): HTMLInputElement {
  const input = editor.editor.view.dom.querySelector<HTMLInputElement>(
    'ul[data-type="taskList"] > li > label > input[type="checkbox"]',
  );
  if (!input) throw new Error('no checkbox rendered for the task item');
  return input;
}

const FIRST_CHILD_IS_A_BLOCK: ReadonlyArray<readonly [string, string]> = [
  ['a heading', '- [ ] ## h'],
  ['an ordered list', '- [ ] 1. a'],
  ['a bullet list', '- [ ] - a'],
  ['a blockquote', '- [ ] > q'],
  ['a fenced block', '- [ ] ```\n  code\n  ```'],
  ['a table', '- [ ] | a | b |\n  | --- | --- |\n  | 1 | 2 |'],
  ['a horizontal rule', '- [ ] ---'],
];

describe('the checkbox of an item whose first child is a block (#157)', () => {
  it.each(FIRST_CHILD_IS_A_BLOCK)(
    'is still rendered when the first child is %s',
    (_l, markdown) => {
      const editor = editorWith(markdown);
      const item = checkboxOf(editor).closest('li');
      // Before the content, not inside it: the label is the item's first child,
      // which is what keeps the checkbox at the left of whatever the block is.
      expect(item?.firstElementChild?.nodeName).toBe('LABEL');
      expect(item?.children.length).toBe(2);
    },
  );

  it.each(FIRST_CHILD_IS_A_BLOCK)('is the first child rather than a paragraph — %s', (_l, md) => {
    const first = editorWith(md).editor.getJSON().content?.[0]?.content?.[0]?.content?.[0];
    expect(first?.type).not.toBe('paragraph');
  });

  it('answers a click when the first child is a heading', () => {
    // The gesture, not the command: the node view listens for `change` on the
    // input, and that listener is the only route from the checkbox to the
    // document. A test that called `updateAttributes` would pass with the
    // checkbox unreachable.
    const editor = editorWith('- [ ] ## h');
    const checkbox = checkboxOf(editor);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(editor.getMarkdown()).toBe('- [x] ## h');
  });

  it('unticks again from the same gesture', () => {
    const editor = editorWith('- [x] ## h');
    const checkbox = checkboxOf(editor);
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(editor.getMarkdown()).toBe('- [ ] ## h');
  });

  it('writes two paragraphs in one item as one, and says so', () => {
    // The one shape #157 could not make byte-exact, recorded in REQUIREMENTS
    // as an R-C2 exception. **No file can hold it** — a loose task list is not
    // read as a task list on the way in — so the only way here is an edit, and
    // this is that edit: Backspace at the start of the second item joins the
    // two into one item holding two paragraphs. Writing them a blank line
    // apart would put the `[ ]` marker inside a paragraph of its own, which
    // reads back as a plain bullet, so the break goes and the checkbox stays.
    const editor = editorWith('- [ ] a\n- [x] b');
    let position = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'b') position = pos;
    });
    editor.editor.commands.setTextSelection(position);
    const view = editor.editor.view;
    view.someProp('handleKeyDown', (handler) =>
      handler(view, new KeyboardEvent('keydown', { key: 'Backspace' })),
    );

    expect(JSON.stringify(editor.editor.getJSON())).toContain(
      // The two attributes every paragraph carries since #461, unset here.
      '{"type":"paragraph","attrs":{"htmlBlockSource":null,"keptHtmlBlockSource":null},"content":[{"type":"text","text":"b"}]}',
    );
    expect(editor.getMarkdown()).toBe('- [ ] a\n  b');
    // What the file says when it is opened again: one paragraph wrapped over
    // two lines, the checkbox intact. The text is all there and so is the
    // line, written back as it is since #571; the paragraph break is not.
    instance?.destroy();
    instance = null;
    const reopened = editorWith('- [ ] a\n  b');
    expect(reopened.editor.state.doc.firstChild?.firstChild?.childCount).toBe(1);
    expect(reopened.getMarkdown()).toBe('- [ ] a\n  b');
  });

  it.each(FIRST_CHILD_IS_A_BLOCK)(
    'carries the tick through the round trip — %s',
    (_l, markdown) => {
      // Both states, because the attribute is written from the item and read
      // back from the file: an item that always saved unticked would pass a test
      // that only opened `- [ ]`.
      const ticked = markdown.replace('- [ ]', '- [x]');
      expect(editorWith(ticked).getMarkdown()).toBe(ticked);
      instance?.destroy();
      instance = null;
      expect(editorWith(markdown).getMarkdown()).toBe(markdown);
    },
  );
});
