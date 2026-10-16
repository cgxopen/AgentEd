import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * A heading keeps its underline or its closing hashes (#573, owner decisions A
 * and D on the step zero). See `markdown/heading-spelling.ts` for the route;
 * the unedited save of the whole path is pinned by the CommonMark suite.
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

/** Type ` more` after `text`, as an edit of the heading holding it. */
function editAfter(instance: EditorInstance, text: string): string {
  instance.editor
    .chain()
    .setTextSelection(positionAfter(instance, text))
    .insertContent(' more')
    .run();
  return instance.getMarkdown();
}

/** Each heading at the top level, in a quote and in a list item. */
function inEachContainer(heading: string): Array<[string, string]> {
  const indented = heading.split('\n');
  return [
    ['at the top level', heading],
    ['in a quote', indented.map((line) => `> ${line}`).join('\n')],
    ['in a list item', indented.map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`)).join('\n')],
  ];
}

const SETEXT = [
  ['a first-level underline longer than the text', 'Title\n=========='],
  ['a first-level underline shorter than the text', 'A long title\n=='],
  ['a second-level underline longer than the text', 'Section\n------------'],
  ['a second-level underline of one hyphen', 'Section title\n-'],
] as const;

const CLOSING = [
  ['one closing hash', '# Title #'],
  ['closing hashes as many as the opening ones', '### Title ###'],
  ['more closing hashes than opening ones', '## Title ########'],
  ['fewer closing hashes than opening ones', '###### Title ##'],
  ['spaces before the closing hashes', '## Title    ##'],
] as const;

const CASES = [...SETEXT, ...CLOSING].flatMap(([label, heading]) =>
  inEachContainer(heading).map(([where, markdown]) => [`${label}, ${where}`, markdown] as const),
);

describe('an unedited save keeps the spelling of every heading (#573)', () => {
  it.each(CASES)('%s', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });
});

describe('an edit to the text keeps the spelling (#573)', () => {
  it.each(CASES)('%s', (_label, markdown) => {
    const word = markdown.includes('Section') ? 'Section' : 'itle';
    const edited = markdown.replace(word, `${word} more`);
    expect(editAfter(editorWith(markdown), word)).toBe(edited);
  });
});

describe('what is not carried is written as before (#573)', () => {
  it.each([
    ['the spaces after the closing hashes', '## Title ##  ', '## Title ##'],
    ['two spaces after the opening hashes', '##  Title ##', '## Title ##'],
    ['an indented underline', 'Title\n   ===', 'Title\n==='],
    ['an underlined heading over two lines, as main writes it', 'One\ntwo\n===', '# One two'],
  ])('%s', (_label, markdown, written) => {
    expect(editorWith(markdown).getMarkdown()).toBe(written);
  });
});

describe('a heading the editor makes carries nothing (#573)', () => {
  it('a heading turned into a paragraph and back is written with hashes', () => {
    const editor = editorWith('Title\n=====');
    editor.editor.chain().setTextSelection(2).setParagraph().toggleHeading({ level: 1 }).run();
    expect(editor.getMarkdown()).toBe('# Title');
  });

  it('closing hashes go the same way', () => {
    const editor = editorWith('## Title ##');
    editor.editor.chain().setTextSelection(2).setParagraph().toggleHeading({ level: 2 }).run();
    expect(editor.getMarkdown()).toBe('## Title');
  });

  it.each([
    ['an underlined heading', 'Title\n=====', '#'],
    ['a heading with closing hashes', '## Title ##', '##'],
  ])(
    '%s emptied in the editor is written as its hashes alone (#564)',
    (_label, markdown, written) => {
      const editor = editorWith(markdown);
      editor.editor.chain().setTextSelection({ from: 1, to: 6 }).deleteSelection().run();
      expect(editor.getMarkdown()).toBe(written);
    },
  );

  it('a level the underline cannot spell is written with hashes', () => {
    const editor = editorWith('Title\n=====');
    editor.editor.chain().setTextSelection(2).toggleHeading({ level: 2 }).run();
    expect(editor.getMarkdown()).toBe('## Title');
  });

  it('a second level underlined with hyphens turned into a first level', () => {
    const editor = editorWith('Title\n-----');
    editor.editor.chain().setTextSelection(2).toggleHeading({ level: 1 }).run();
    expect(editor.getMarkdown()).toBe('# Title');
  });

  it('Enter at the end of an underlined heading makes a paragraph with nothing', () => {
    const editor = editorWith('Title\n=====');
    editor.editor.chain().setTextSelection(6).splitBlock().insertContent('New').run();
    expect(editor.getMarkdown()).toBe('Title\n=====\n\nNew');
  });

  it('Enter inside an underlined heading leaves the second half with nothing', () => {
    // `tr.split` copies every attribute of the node it splits; the plugin of
    // #594 clears the spelling off the second half as it clears the flag.
    const editor = editorWith('Title\n=====');
    editor.editor.chain().setTextSelection(3).splitBlock().run();
    expect(editor.getMarkdown()).toBe('Ti\n=====\n\n# tle');
  });

  it('Enter inside a heading with closing hashes does the same', () => {
    const editor = editorWith('## Head ##');
    editor.editor.chain().setTextSelection(3).splitBlock().run();
    expect(editor.getMarkdown()).toBe('## He ##\n\n## ad');
  });

  it('a plain-text paste of an underlined heading is written with hashes', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, { text: 'Pasted\n======\n\n## Also ##\n' });
    // The paste ends inside its last block, so `start` joins it, as any paste does.
    expect(editor.getMarkdown()).toBe('# Pasted\n\n## Alsostart');
  });

  it('a page that spells the attributes pastes the hash spelling (#447)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, {
      html: '<h1 data-setext-underline="===">Pasted</h1><h2 data-atx-closing="%20%23%23">Also</h2>',
      text: 'Pasted Also',
    });
    // The paste ends inside its last block, so `start` joins it, as any paste does.
    expect(editor.getMarkdown()).toBe('# Pasted\n\n## Alsostart');
  });
});
