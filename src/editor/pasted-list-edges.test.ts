import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * #690: a list pasted as HTML arrives whole.
 *
 * On `901c711` a list copied in one AgentEd window and pasted into a second,
 * or copied from a page, joined its first item to the text before the caret
 * and its last item to the text after it, each losing its marker and box.
 * Each row here pastes the HTML a copy puts on the clipboard, through the
 * handler the app uses, with the caret at the start, the middle and the end
 * of a paragraph, a heading, a paragraph in a quote, a bullet item and a task
 * item. A copy from another window carries a token this window does not know,
 * so it takes the cleaned route, as in the app (#447).
 *
 * Every list row writes what the same rows wrote in Chromium running the
 * built application under route (d) in the step zero of #690 (comment
 * 6604318114), and what a paste in the same window writes, which is asserted
 * beside it: the same window is the reference the acceptance names.
 */

let instances: EditorInstance[] = [];

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.innerHTML = '';
});

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  instances.push(instance);
  return instance;
}

/** Fire a paste carrying `html` and `text`; true when the handler took it. */
function paste(instance: EditorInstance, html: string, text: string): boolean {
  const data: Record<string, string> = { 'text/html': html, 'text/plain': text };
  const event = {
    clipboardData: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
      files: [],
    },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = instance.editor;
  return Boolean(
    view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content())),
  );
}

/** What a window puts on the clipboard for a copy of a whole document. */
function copyOf(markdown: string): string {
  const { view, state } = editorWith(markdown).editor;
  return view.serializeForClipboard(state.doc.slice(0, state.doc.content.size)).dom.innerHTML;
}

/** The same copy as another window wrote it: a token this window does not know. */
function fromASecondWindow(html: string): string {
  return html.replace(/data-agented-copy="[0-9a-f]+"/, 'data-agented-copy="0000"');
}

const TEXT = 'start middle end';
const CARETS = { start: 0, middle: 6, end: 16 } as const;
type Caret = keyof typeof CARETS;

const TARGETS = {
  paragraph: TEXT,
  heading: `## ${TEXT}`,
  'paragraph in a quote': `> ${TEXT}`,
  'bullet item': `- ${TEXT}`,
  'task item': `- [ ] ${TEXT}`,
} as const;
type Target = keyof typeof TARGETS | 'empty paragraph' | 'empty document';

/** An editor holding `target`, the caret placed in it. */
function targetWithCaret(target: Target, caret: Caret): EditorInstance {
  if (target === 'empty document') {
    const instance = editorWith('');
    instance.editor.commands.setTextSelection(1);
    return instance;
  }
  if (target === 'empty paragraph') {
    const instance = editorWith('');
    instance.editor.commands.setContent('<p>above</p><p></p><p>below</p>');
    instance.editor.commands.setTextSelection(8);
    return instance;
  }
  const instance = editorWith(TARGETS[target]);
  let at = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === TEXT) at = pos + 1;
  });
  if (at < 0) throw new Error(`no text block holding ${TEXT} in ${target}`);
  instance.editor.commands.setTextSelection(at + CARETS[caret]);
  return instance;
}

/** The markdown written after pasting `html` from a second window. */
function pastedFromASecondWindow(html: string, target: Target, caret: Caret): string {
  const instance = targetWithCaret(target, caret);
  expect(paste(instance, fromASecondWindow(html), 'a b')).toBe(true);
  return instance.getMarkdown();
}

/** The markdown written after pasting `html` from a page. */
function pastedFromAPage(html: string, target: Target, caret: Caret): string {
  const instance = targetWithCaret(target, caret);
  expect(paste(instance, html, 'a b')).toBe(true);
  return instance.getMarkdown();
}

/** The markdown written after pasting `html` back into the window that copied it. */
function pastedInTheSameWindow(html: string, target: Target, caret: Caret): string {
  const instance = targetWithCaret(target, caret);
  // The handler declines a copy of this window, and ProseMirror reads it.
  if (!paste(instance, html, 'a b')) instance.editor.view.pasteHTML(html);
  return instance.getMarkdown();
}

const LISTS = {
  'task list': { markdown: '- [ ] a\n- [x] b', items: ['- [ ] a', '- [x] b'] },
  'bullet list': { markdown: '- a\n- b', items: ['- a', '- b'] },
  'ordered list': { markdown: '1. a\n2. b', items: ['1. a', '2. b'] },
} as const;

/** What each target writes with the list whole in it, as Chromium wrote it. */
function expectedRows(items: readonly string[]): [Target, Caret, string][] {
  const list = items.join('\n');
  const quoted = items.map((line) => `> ${line}`).join('\n');
  const nested = items.map((line) => `  ${line}`).join('\n');
  return [
    ['paragraph', 'start', `${list}\n\nstart middle end`],
    ['paragraph', 'middle', `start\n\n${list}\n\nmiddle end`],
    ['paragraph', 'end', `start middle end\n\n${list}`],
    ['empty paragraph', 'start', `above\n\n${list}\n\nbelow`],
    ['empty document', 'start', list],
    ['heading', 'start', `${list}\n\n## start middle end`],
    ['heading', 'middle', `## start\n\n${list}\n\n## middle end`],
    ['heading', 'end', `## start middle end\n\n${list}`],
    ['paragraph in a quote', 'start', `${quoted}\n> \n> start middle end`],
    ['paragraph in a quote', 'middle', `> start\n> \n${quoted}\n> \n> middle end`],
    ['paragraph in a quote', 'end', `> start middle end\n> \n${quoted}`],
    ['bullet item', 'start', `- ${items[0]}\n  ${items[1]}\n\n  start middle end`],
    ['bullet item', 'middle', `- start\n\n${nested}\n\n  middle end`],
    ['bullet item', 'end', `- start middle end\n${nested}`],
    ['task item', 'start', `- [ ] ${items[0]}\n  ${items[1]}\n  start middle end`],
    ['task item', 'middle', `- [ ] start\n${nested}\n  middle end`],
    ['task item', 'end', `- [ ] start middle end\n${nested}`],
  ];
}

describe('a list copied in a second AgentEd window arrives whole (#690)', () => {
  for (const [name, list] of Object.entries(LISTS)) {
    describe(name, () => {
      for (const [target, caret, expected] of expectedRows(list.items)) {
        it(`into a ${target}, ${caret}`, () => {
          const html = copyOf(list.markdown);
          expect(pastedFromASecondWindow(html, target, caret)).toBe(expected);
          expect(pastedInTheSameWindow(html, target, caret)).toBe(expected);
        });
      }
    });
  }
});

describe('a list copied from a page arrives whole (#690)', () => {
  // The HTML GitHub renders for a task list, as on #689, styles left out:
  // the box is read by #691 and the list then made whole here.
  const box = (checked: boolean) =>
    `<input type="checkbox" class="task-list-item-checkbox" disabled=""${checked ? ' checked=""' : ''}>`;
  const github =
    `<ul class="contains-task-list"><li class="task-list-item">${box(false)} an unticked item</li>` +
    `<li class="task-list-item">${box(true)} a ticked item</li>` +
    `<li class="task-list-item">${box(false)} an item holding a nested list` +
    `<ul class="contains-task-list"><li class="task-list-item">${box(true)} a ticked nested item</li>` +
    `<li class="task-list-item">${box(false)} an unticked nested item</li></ul></li></ul>`;
  const githubList =
    '- [ ] an unticked item\n- [x] a ticked item\n- [ ] an item holding a nested list\n' +
    '  - [x] a ticked nested item\n  - [ ] an unticked nested item';
  const ordinary = '<ul><li>a</li><li>b</li></ul>';

  const rows: [string, string, Caret, string][] = [
    ['GitHub', github, 'start', `${githubList}\n\nstart middle end`],
    ['GitHub', github, 'middle', `start\n\n${githubList}\n\nmiddle end`],
    ['GitHub', github, 'end', `start middle end\n\n${githubList}`],
    ['an ordinary page', ordinary, 'start', '- a\n- b\n\nstart middle end'],
    ['an ordinary page', ordinary, 'middle', 'start\n\n- a\n- b\n\nmiddle end'],
    ['an ordinary page', ordinary, 'end', 'start middle end\n\n- a\n- b'],
  ];
  for (const [page, html, caret, expected] of rows) {
    it(`from ${page}, into a paragraph, ${caret}`, () => {
      expect(pastedFromAPage(html, 'paragraph', caret)).toBe(expected);
    });
  }
});

describe('what stays as on main (#690)', () => {
  it('a single paragraph from a second window joins the sentence at the caret', () => {
    const html = copyOf('one sentence');
    expect(pastedFromASecondWindow(html, 'paragraph', 'middle')).toBe(
      'start one sentencemiddle end',
    );
  });

  it('a single paragraph from a page joins the sentence at the caret', () => {
    expect(pastedFromAPage('<p>one sentence</p>', 'paragraph', 'middle')).toBe(
      'start one sentencemiddle end',
    );
  });

  it('a paragraph at each edge of the copy joins the text, the list between them whole', () => {
    const html = copyOf('before\n\n- a\n- b\n\nafter');
    expect(pastedFromASecondWindow(html, 'paragraph', 'start')).toBe(
      'before\n\n- a\n- b\n\nafterstart middle end',
    );
    expect(pastedFromASecondWindow(html, 'paragraph', 'middle')).toBe(
      'start before\n\n- a\n- b\n\naftermiddle end',
    );
    expect(pastedFromASecondWindow(html, 'paragraph', 'end')).toBe(
      'start middle endbefore\n\n- a\n- b\n\nafter',
    );
  });

  it('a table from a second window splits the paragraph and keeps the text after it', () => {
    const html = copyOf('| x | y |\n| --- | --- |\n| 1 | 2 |');
    expect(pastedFromASecondWindow(html, 'paragraph', 'middle')).toBe(
      'start\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n\nmiddle end',
    );
  });
});
