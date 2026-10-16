import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipboardSerializerWithToken } from './clipboard-token';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * A link keeps what the file wrote between its parentheses (#573, owner
 * decision B on the step zero). See `markdown/destination-spelling.ts` for the
 * route; the unedited save of the whole path is pinned by the CommonMark suite.
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

/** The position just before the first character of `text`. */
function positionOf(instance: EditorInstance, text: string): number {
  return positionAfter(instance, text) - text.length;
}

/** Each link at the top level, in a quote, in a list item, in a table cell and in an emphasis. */
function inEachContainer(link: string): Array<[string, string]> {
  return [
    ['at the top level', `See ${link} now.`],
    ['in a quote', `> See ${link} now.`],
    ['in a list item', `- See ${link} now.`],
    ['in a table cell', `| a | b |\n| --- | --- |\n| See ${link} now. | x |`],
    ['inside an emphasis', `*See ${link} now.*`],
  ];
}

const LINKS = [
  ['angle brackets around a space', '[n](<docs/my notes.md>)'],
  ['angle brackets around no space', '[n](<docs/notes.md>)'],
  ['balanced parentheses', '[r](https://en.wikipedia.org/wiki/Rust_(programming_language))'],
  ['escaped parentheses and a colon', '[x](foo\\)\\:)'],
  ['a backslash', '[x](foo\\bar)'],
  ['a character reference in the destination', '[a](/f&ouml;&ouml;)'],
  ['character references in the title', '[a](/u "f&ouml;&ouml;")'],
  ['a path outside ASCII', '[w](https://ro.wikipedia.org/wiki/București)'],
  ['spacing around the destination and before the title', '[t](  /u   "a" )'],
  ['a title in double quotes', '[t](/u "a title")'],
  ['a title in single quotes', "[t](/u 'a title')"],
  ['a title in parentheses', '[t](/u (a title))'],
  ['an ampersand reference in a query', '[q](/s?a=1&amp;b=2)'],
  ['a literal ampersand that spells a reference (#447)', '[q](/s?x=1&amp;copy;=2)'],
  ['a title ending in an escaped backslash', '[e](/u "t\\\\")'],
] as const;

const CASES = LINKS.flatMap(([label, link]) =>
  inEachContainer(link).map(([where, markdown]) => [`${label}, ${where}`, markdown] as const),
);

/**
 * What the save writes: the file itself, but in an emphasis, which splits
 * around the link by the overlapping-marks exception while the parentheses
 * stay as the file wrote them.
 */
function written(markdown: string): string {
  const m = /^\*See \[(.*?)\](\(.*\)) now\.\*$/.exec(markdown);
  return m ? `*See* [*${m[1]}*]${m[2]} *now.*` : markdown;
}

describe('an unedited save keeps what every link wrote between its parentheses (#573)', () => {
  it.each(CASES)('%s', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(written(markdown));
  });

  it('two links side by side, one address in two spellings, keep each its own (#565, D5)', () => {
    const markdown = '[a](</x y>) [b](/x%20y)';
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });
});

describe('what is not carried is written as before (#573)', () => {
  it.each([
    ['a destination and a title on two lines (example 510)', '[l](   /u\n  "t"  )', '[l](/u "t")'],
    ['in a quote', '> [l](   /u\n>   "t"  )', '> [l](/u "t")'],
    ['in a list item', '- [l](   /u\n    "t"  )', '- [l](/u "t")'],
    ['an image', '![i](<a b.png>)', '![i](a%20b.png)'],
  ])('%s', (_label, markdown, written) => {
    expect(editorWith(markdown).getMarkdown()).toBe(written);
  });
});

describe('the routes into the attribute (#573)', () => {
  it('a new address from the link dialog writes the link inline with it, as #570 E2', () => {
    // `setMark` merges attributes, so the mark keeps the spelling of the old
    // address; the check at save refuses it, since it makes another link.
    const editor = editorWith('See [n](<docs/my notes.md>) and [r](/a_(b)).');
    editor.editor
      .chain()
      .setTextSelection(positionOf(editor, 'n') + 1)
      .extendMarkRange('link', editor.editor.getAttributes('link'))
      .setMark('link', { href: 'docs/other.md', reference: null })
      .run();
    expect(editor.getMarkdown()).toBe('See [n](docs/other.md) and [r](/a_(b)).');
  });

  it('a new title writes the link from what the editor holds', () => {
    const editor = editorWith('See [n](<docs/my notes.md> "old").');
    editor.editor
      .chain()
      .setTextSelection(positionOf(editor, 'n') + 1)
      .extendMarkRange('link')
      .updateAttributes('link', { title: 'new' })
      .run();
    expect(editor.getMarkdown()).toBe('See [n](docs/my%20notes.md "new").');
  });

  it('a letter typed inside the link text keeps the spelling', () => {
    const editor = editorWith('See [Rust](https://e.org/wiki/Rust_(lang)) now.');
    editor.editor.chain().setTextSelection(positionAfter(editor, 'Ru')).insertContent('X').run();
    expect(editor.getMarkdown()).toBe('See [RuXst](https://e.org/wiki/Rust_(lang)) now.');
  });

  it('Enter inside the link text leaves both halves a spelling still true', () => {
    const editor = editorWith('See [Rust](https://e.org/wiki/Rust_(lang)) now.');
    editor.editor.chain().setTextSelection(positionAfter(editor, 'Ru')).splitBlock().run();
    expect(editor.getMarkdown()).toBe(
      'See [Ru](https://e.org/wiki/Rust_(lang))\n\n[st](https://e.org/wiki/Rust_(lang)) now.',
    );
  });

  it('a copy and paste inside one window keeps the spelling', () => {
    const editor = editorWith('See [n](<docs/my notes.md>) now.\n\nEnd.');
    const { view } = editor.editor;
    const from = positionOf(editor, 'n');
    editor.editor.commands.setTextSelection({ from, to: from + 1 });
    // The clipboard HTML of a copy from this window: the editor serializer,
    // which writes the token of the window, and the slice ProseMirror records.
    const slice = view.state.selection.content();
    const dom = document.createElement('div');
    dom.appendChild(
      clipboardSerializerWithToken(view.state.schema).serializeFragment(slice.content),
    );
    dom.firstElementChild?.setAttribute('data-pm-slice', `${slice.openStart} ${slice.openEnd} []`);
    editor.editor.commands.setTextSelection(positionAfter(editor, 'End.'));
    // Through the whole paste route, which hands a copy from this window to ProseMirror.
    view.pasteHTML(dom.innerHTML);
    expect(editor.getMarkdown()).toBe(
      'See [n](<docs/my notes.md>) now.\n\nEnd.[n](<docs/my notes.md>)',
    );
  });

  it('a plain-text paste of markdown carries nothing', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, { text: '[n](<docs/my notes.md>) ' });
    expect(editor.getMarkdown()).toBe('[n](docs/my%20notes.md) start');
  });

  it('a page that spells the attribute carries nothing (#447)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, {
      html: '<p><a href="/u" data-link-destination="%3C%2Fu%3E">n</a> </p>',
      text: 'n ',
    });
    expect(editor.getMarkdown()).toBe('[n](/u)start');
  });

  it('a link with an escaped pipe copied into a cell writes the destination it holds', () => {
    // Its spelling escapes the pipe already, and the cell escapes it again:
    // written as is, the pipe would end the cell and the table lose a column.
    const editor = editorWith('See [l](</b\\|c>) now.\n\n| h | k |\n| --- | --- |\n| x | y |');
    const { view } = editor.editor;
    const from = positionOf(editor, 'l');
    editor.editor.commands.setTextSelection({ from, to: from + 1 });
    const slice = view.state.selection.content();
    const dom = document.createElement('div');
    dom.appendChild(
      clipboardSerializerWithToken(view.state.schema).serializeFragment(slice.content),
    );
    dom.firstElementChild?.setAttribute('data-pm-slice', `${slice.openStart} ${slice.openEnd} []`);
    editor.editor.commands.setTextSelection(positionAfter(editor, 'x'));
    view.pasteHTML(dom.innerHTML);
    const written = editor.getMarkdown();
    expect(written).toBe(
      'See [l](</b\\|c>) now.\n\n| h | k |\n| --- | --- |\n| x[l](/b%7Cc) | y |',
    );
    expect(editorWith(written).getMarkdown()).toBe(written);
  });

  it('a pipe escaped in the destination of a link in a cell is written back escaped', () => {
    const markdown = '| a | b |\n| --- | --- |\n| [l](</b\\|c>) | x |';
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });
});
