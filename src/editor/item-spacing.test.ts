import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * The blank line between two blocks of a list item (#601). See
 * `markdown/item-spacing.ts` for the route; the unedited save of the whole
 * path is pinned by the CommonMark suite, example 109.
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

/** The position just after the paragraph whose text is `text`. */
function positionAfterParagraph(instance: EditorInstance, text: string): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'paragraph' && node.textContent === text) {
      found = pos + node.nodeSize;
    }
  });
  if (found === -1) throw new Error(`no paragraph ${text} in the document`);
  return found;
}

/** `markdown` inside a quote, its blank lines spelled as a bare marker. */
function inQuote(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/** `markdown` as the content of a list item under `- x`. */
function inItem(markdown: string): string {
  return `- x\n\n${markdown
    .split('\n')
    .map((line) => (line === '' ? '' : `  ${line}`))
    .join('\n')}`;
}

const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['a bullet item, the outer list tight', '- a\n\n  - b\n- c'],
  ['a bullet item, the outer list loose', '- a\n\n  - b\n\n- c'],
  ['an ordered item', '1. a\n\n   1. b\n2. c'],
  ['a task item', '- [ ] a\n\n  - [ ] b\n- [ ] c'],
  ['a task item, the outer list loose', '- [ ] a\n\n  - [ ] b\n\n- [ ] c'],
  ['a nested ordered list under a bullet item', '- a\n\n  1. b\n- c'],
  ['a nested bullet list under an ordered item', '1. a\n\n   - b\n2. c'],
  ['two paragraphs, then a nested list', '- a\n\n  more\n\n  - b\n- c'],
  ['three levels deep', '- a\n\n  - b\n\n    - c\n- d'],
  ['a run of two blank lines', '- a\n\n\n  - b\n- c'],
  ['an empty first nested item, still a blank line under (#564, D3)', '- a\n\n  -\n- c'],
  ['an empty first nested item under a task item', '- [ ] a\n\n  -\n- [ ] c'],
  ['two paragraphs in one task item', '- [ ] one\n\n  two'],
  ['a heading a blank line under the paragraph of a task item', '- [ ] a\n\n  ## h'],
  ['a fence a blank line under an empty task marker line', '- [ ] \n\n  ```\n  c\n  ```'],
  ['the tight control', '- a\n  - b\n- c'],
  ['the tight control, as a task list', '- [ ] a\n  - [ ] b\n- [ ] c'],
];

describe('a block a blank line under the one above it in an item keeps it (#601)', () => {
  it.each(SHAPES)('%s, at the top level', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });

  it.each(SHAPES)('%s, in a quote', (_label, markdown) => {
    expect(editorWith(inQuote(markdown)).getMarkdown()).toBe(inQuote(markdown));
  });

  it.each(SHAPES)('%s, in a list item', (_label, markdown) => {
    expect(editorWith(inItem(markdown)).getMarkdown()).toBe(inItem(markdown));
  });

  it('a line of spaces between them is written as the blank line it reads as', () => {
    expect(editorWith('- a\n  \n  - b').getMarkdown()).toBe('- a\n\n  - b');
  });
});

describe('a task list keeps its marker (#431)', () => {
  it.each([
    ['a star', '* [ ] a\n* [x] b'],
    ['a plus sign', '+ [ ] a'],
    ['a star, nested under a plus sign', '+ [ ] a\n  * [ ] b'],
    ['an empty item at the end, its space kept (#160)', '* [ ] a\n* [ ] '],
  ])('%s', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });

  it('a task list the editor makes is written with a hyphen, as before', () => {
    const editor = editorWith('a');
    editor.editor.chain().setTextSelection(1).toggleTaskList().run();
    expect(editor.getMarkdown()).toBe('- [ ] a');
  });
});

const FILES = [
  ['a bullet list', '- alpha\n\n  - beta\n  - gamma\n- delta', 'listItem', '- '],
  ['a task list', '- [ ] alpha\n\n  - [ ] beta\n  - [ ] gamma\n- [ ] delta', 'taskItem', '- [ ] '],
] as const;

describe.each(FILES)('the routes of an edit, in %s (#601)', (_label, markdown, item, m) => {
  const nested = (line: string) => `  ${m}${line}`;

  it('a letter typed after the paragraph keeps the blank line', () => {
    const editor = editorWith(markdown);
    editor.editor.chain().setTextSelection(positionAfter(editor, 'alpha')).insertContent('X').run();
    expect(editor.getMarkdown()).toBe(markdown.replace('alpha', 'alphaX'));
  });

  it('Enter at the end of the paragraph: the nested list follows the new item with its blank line', () => {
    // The count rides on the nested list and follows it, as the flag of #568
    // follows its block (owner decision D3); the split moves the list whole,
    // so the plugin of #594 does not reach it.
    const editor = editorWith(markdown);
    editor.editor
      .chain()
      .setTextSelection(positionAfter(editor, 'alpha'))
      .splitListItem(item)
      .insertContent('X')
      .run();
    expect(editor.getMarkdown()).toBe(
      [`${m}alpha`, `${m}X`, '', nested('beta'), nested('gamma'), `${m}delta`].join('\n'),
    );
  });

  it('Enter inside the paragraph does the same', () => {
    const editor = editorWith(markdown);
    editor.editor.chain().setTextSelection(positionAfter(editor, 'al')).splitListItem(item).run();
    expect(editor.getMarkdown()).toBe(
      [`${m}al`, `${m}pha`, '', nested('beta'), nested('gamma'), `${m}delta`].join('\n'),
    );
  });

  it('Enter at the end of the nested list adds a tight item to it', () => {
    const editor = editorWith(markdown);
    editor.editor
      .chain()
      .setTextSelection(positionAfter(editor, 'gamma'))
      .splitListItem(item)
      .insertContent('X')
      .run();
    expect(editor.getMarkdown()).toBe(
      [`${m}alpha`, '', nested('beta'), nested('gamma'), nested('X'), `${m}delta`].join('\n'),
    );
  });

  it('Enter at the end of the outer list adds a tight item to it', () => {
    const editor = editorWith(markdown);
    editor.editor
      .chain()
      .setTextSelection(positionAfter(editor, 'delta'))
      .splitListItem(item)
      .insertContent('X')
      .run();
    expect(editor.getMarkdown()).toBe(`${markdown}\n${m}X`);
  });

  it('a paragraph inserted between the paragraph and the list carries nothing', () => {
    const editor = editorWith(markdown);
    editor.editor
      .chain()
      .insertContentAt(positionAfterParagraph(editor, 'alpha'), {
        type: 'paragraph',
        content: [{ type: 'text', text: 'X' }],
      })
      .run();
    // A bullet item writes two paragraphs a blank line apart whatever they
    // carry; a task item writes a block that carries nothing one newline under
    // the one above, the recorded exception for two paragraphs in one task item.
    const between = item === 'listItem' ? '\n\n  X\n\n' : '\n  X\n\n';
    expect(editor.getMarkdown()).toBe(markdown.replace('alpha\n\n', `alpha${between}`));
  });

  it('Tab on a nested item makes a list under it, tight', () => {
    const editor = editorWith(markdown);
    editor.editor.chain().setTextSelection(positionAfter(editor, 'gamma')).sinkListItem(item).run();
    expect(editor.getMarkdown()).toBe(
      [`${m}alpha`, '', nested('beta'), `    ${m}gamma`, `${m}delta`].join('\n'),
    );
  });

  it('Shift+Tab on the first nested item: the list left behind keeps its blank line', () => {
    const editor = editorWith(markdown);
    editor.editor.chain().setTextSelection(positionAfter(editor, 'beta')).liftListItem(item).run();
    expect(editor.getMarkdown()).toBe(
      [`${m}alpha`, `${m}beta`, '', nested('gamma'), `${m}delta`].join('\n'),
    );
  });

  it('Tab on the last outer item moves it into the nested list, tight', () => {
    const editor = editorWith(markdown);
    editor.editor.chain().setTextSelection(positionAfter(editor, 'delta')).sinkListItem(item).run();
    expect(editor.getMarkdown()).toBe(
      [`${m}alpha`, '', nested('beta'), nested('gamma'), nested('delta')].join('\n'),
    );
  });

  it('a nested list made with Tab is written tight, as before', () => {
    const editor = editorWith(`${m}a\n${m}b`);
    editor.editor.chain().setTextSelection(positionAfter(editor, 'b')).sinkListItem(item).run();
    expect(editor.getMarkdown()).toBe(`${m}a\n  ${m}b`);
  });
});
