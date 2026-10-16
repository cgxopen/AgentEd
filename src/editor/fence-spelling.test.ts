import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitBlockLanguage } from './code-block-language';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * A fence keeps the run it was opened with and the gap before its info string
 * (#573, owner decision C on the step zero). See `markdown/fence-spelling.ts`
 * for the route; the unedited save of the whole path is pinned by the
 * CommonMark suite.
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

/** Type ` more` after `text`, as an edit of the code holding it. */
function editAfter(instance: EditorInstance, text: string): string {
  instance.editor
    .chain()
    .setTextSelection(positionAfter(instance, text))
    .insertContent(' more')
    .run();
  return instance.getMarkdown();
}

/** The position of the first code block, where its language widget stands. */
function codeBlockAt(instance: EditorInstance): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'codeBlock') found = pos;
  });
  if (found === -1) throw new Error('no code block in the document');
  return found;
}

/** Each fence at the top level, in a quote and in a list item. */
function inEachContainer(fence: string): Array<[string, string]> {
  const lines = fence.split('\n');
  return [
    ['at the top level', fence],
    ['in a quote', lines.map((line) => `> ${line}`).join('\n')],
    ['in a list item', lines.map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`)).join('\n')],
  ];
}

const FENCES = [
  ['four backticks', '````\ncode\n````'],
  ['four backticks and a language', '````js\ncode\n````'],
  ['six backticks and a language', '``````js\ncode\n``````'],
  ['three backticks, one space before the language', '``` js\ncode\n```'],
  ['three backticks, two spaces before the language', '```  js\ncode\n```'],
  ['four backticks, one space before the language', '```` js\ncode\n````'],
  ['three tildes', '~~~\ncode\n~~~'],
  ['four tildes and a language, after a space', '~~~~ py\ncode\n~~~~'],
] as const;

const CASES = FENCES.flatMap(([label, fence]) =>
  inEachContainer(fence).map(([where, markdown]) => [`${label}, ${where}`, markdown] as const),
);

describe('an unedited save keeps the opening of every fence (#573)', () => {
  it.each(CASES)('%s', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });
});

describe('an edit to the code keeps the opening (#573)', () => {
  it.each(CASES)('%s', (_label, markdown) => {
    expect(editAfter(editorWith(markdown), 'code')).toBe(markdown.replace('code', 'code more'));
  });
});

describe('a run the content holds (#573)', () => {
  it.each([
    ['four backticks around three', '````md\n```\ninner\n```\n````'],
    ['tildes around backticks', '~~~\n```\ninner\n```\n~~~'],
    ['backticks around tildes', '````\n~~~\ninner\n~~~\n````'],
    ['four tildes around three', '~~~~\n~~~\ninner\n~~~~'],
  ])('%s is kept', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });

  it('a line typed that would close the tildes writes the fence turndown chooses', () => {
    // Three tildes around a line of three tildes would end the block there.
    const editor = editorWith('~~~\nab\n~~~');
    editor.editor
      .chain()
      .setTextSelection(positionAfter(editor, 'a'))
      .insertContent('\n~~~\n')
      .run();
    expect(editor.getMarkdown()).toBe('```\na\n~~~\nb\n```');
  });

  it('a line of four backticks typed in a four-backtick fence does the same', () => {
    const editor = editorWith('````\nab\n````');
    editor.editor
      .chain()
      .setTextSelection(positionAfter(editor, 'a'))
      .insertContent('\n````\n')
      .run();
    expect(editor.getMarkdown()).toBe('`````\na\n````\nb\n`````');
  });
});

describe('what is not carried is written as before (#573)', () => {
  it.each([
    ['an empty fence of four backticks (#94)', '````\n````', '```\n```'],
    ['an empty fence of tildes (#94)', '~~~\n~~~', '```\n```'],
    ['spaces after a run with no language', '```   \ncode\n```', '```\ncode\n```'],
    ['a closing fence longer than the opening one', '```\ncode\n``````', '```\ncode\n```'],
    ['an indented fence', '  ```\n  code\n  ```', '```\ncode\n```'],
  ])('%s', (_label, markdown, written) => {
    expect(editorWith(markdown).getMarkdown()).toBe(written);
  });
});

describe('the language set from the label keeps the opening (#573, R-C15)', () => {
  it('a language changed', () => {
    const editor = editorWith('````js\ncode\n````');
    commitBlockLanguage(editor.editor.view, codeBlockAt(editor) + 1, 'python');
    expect(editor.getMarkdown()).toBe('````python\ncode\n````');
  });

  it('a language given to a fence that had none, after the gap it never had', () => {
    const editor = editorWith('~~~\ncode\n~~~');
    commitBlockLanguage(editor.editor.view, codeBlockAt(editor) + 1, 'py');
    expect(editor.getMarkdown()).toBe('~~~py\ncode\n~~~');
  });

  it('a language removed drops the gap with it', () => {
    const editor = editorWith('``` js\ncode\n```');
    commitBlockLanguage(editor.editor.view, codeBlockAt(editor) + 1, null);
    expect(editor.getMarkdown()).toBe('```\ncode\n```');
  });
});

describe('a fence the editor makes carries nothing (#573)', () => {
  it('Enter inside a fence writes a newline and splits nothing', () => {
    const editor = editorWith('````js\nab\n````');
    editor.editor.commands.setTextSelection(positionAfter(editor, 'a'));
    const { view } = editor.editor;
    view.someProp('handleKeyDown', (handler) =>
      handler(view, new KeyboardEvent('keydown', { key: 'Enter' })),
    );
    expect(editor.getMarkdown()).toBe('````js\na\nb\n````');
  });

  it('the second half of a block split in two carries nothing', () => {
    // `splitBlock` copies every attribute through `tr.split`; the plugin of
    // #594 clears the opener off the second half as it clears the flag.
    const editor = editorWith('````js\nab\n````');
    editor.editor.chain().setTextSelection(positionAfter(editor, 'a')).splitBlock().run();
    expect(editor.getMarkdown()).toBe('````js\na\n````\n\n```js\nb\n```');
  });

  it('blocks inserted in the middle of one leave the second half with nothing', () => {
    const editor = editorWith('````js\nab\n````');
    editor.editor
      .chain()
      .setTextSelection(positionAfter(editor, 'a'))
      .insertContent('<p>x</p><p>y</p>')
      .run();
    expect(editor.getMarkdown()).toBe('````js\na\n````\n\nx\n\ny\n\n```js\nb\n```');
  });

  it('a plain-text paste of a fence of four backticks is written with three', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, { text: '````js\npasted\n````\n\n~~~\nmore\n~~~\n' });
    // The paste ends inside its last block, so `start` joins it, as any paste does.
    expect(editor.getMarkdown()).toBe('```js\npasted\n```\n\n```\nmore\nstart\n```');
  });

  it('a page that spells the attribute pastes three backticks (#447)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, {
      html: '<pre data-fence-opener="~~~~"><code>pasted</code></pre><p>after</p>',
      text: 'pasted after',
    });
    expect(editor.getMarkdown()).toBe('```\npasted\n```\n\nafterstart');
  });
});
