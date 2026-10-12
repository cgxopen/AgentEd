import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * The title of a link is kept, in the delimiter the file wrote it in (#562).
 * See `markdown/link-title.ts` for the route.
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

function paste(instance: EditorInstance, html: string, text: string): void {
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
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

/** The position of the first character of `text` in the document. */
function positionOf(instance: EditorInstance, text: string): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text);
    }
  });
  if (found === -1) throw new Error(`no ${text} in the document`);
  return found;
}

describe('an unedited save keeps the title of a link and its delimiter (#562)', () => {
  it.each([
    ['in double quotes', '[AgentEd](https://agentedapp.com "Home")'],
    ['in single quotes', "[AgentEd](https://agentedapp.com 'Home')"],
    ['in parentheses', '[AgentEd](https://agentedapp.com (Home))'],
    ['holding a double quote, escaped', '[a](/u "say \\"hi\\"")'],
    ['holding a single quote inside double quotes', '[a](/u "it\'s")'],
    ['on a link in a list item', '- see [a](/u "t")'],
    ['on a link in a heading', '## See [a](/u "t")'],
    ['on a link in a table cell', '| a |\n| --- |\n| [b](/u "t") |'],
  ])('%s', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
    expect(editorWith(editor.getMarkdown()).getMarkdown()).toBe(markdown);
  });

  it('is rendered on the link, where the platform shows it on hover', () => {
    const editor = editorWith('[AgentEd](https://agentedapp.com "Home")');
    expect(editor.editor.view.dom.querySelector('a')?.getAttribute('title')).toBe('Home');
  });

  it('a link with no title has none, as before', () => {
    const editor = editorWith('[AgentEd](https://agentedapp.com)');
    expect(editor.editor.view.dom.querySelector('a')?.hasAttribute('title')).toBe(false);
    expect(editor.getMarkdown()).toBe('[AgentEd](https://agentedapp.com)');
  });

  it('a title read from a reference definition stays in the definition (#570)', () => {
    expect(editorWith("[a][r]\n\n[r]: /u 'Home'").getMarkdown()).toBe("[a][r]\n\n[r]: /u 'Home'");
  });
});

describe('an edit keeps the title (#562)', () => {
  it('the link text edited', () => {
    const editor = editorWith("See [AgentEd](https://agentedapp.com 'Home') now.");
    const at = positionOf(editor, 'Ed');
    editor.editor.chain().setTextSelection(at).insertContent('X').run();
    expect(editor.getMarkdown()).toBe("See [AgentXEd](https://agentedapp.com 'Home') now.");
  });

  it('the address changed with the command of the link dialog keeps the title', () => {
    const editor = editorWith('See [AgentEd](https://agentedapp.com "Home") now.');
    const at = positionOf(editor, 'Agent');
    editor.editor
      .chain()
      .setTextSelection(at)
      .extendMarkRange('link')
      .setLink({ href: 'https://other.example' })
      .run();
    expect(editor.getMarkdown()).toBe('See [AgentEd](https://other.example "Home") now.');
  });

  it('a new link has no title', () => {
    const editor = editorWith('See AgentEd now.');
    const at = positionOf(editor, 'AgentEd');
    editor.editor
      .chain()
      .setTextSelection({ from: at, to: at + 7 })
      .setLink({ href: 'https://agentedapp.com' })
      .run();
    expect(editor.getMarkdown()).toBe('See [AgentEd](https://agentedapp.com) now.');
  });
});

describe('a paste (#562)', () => {
  it('a rich paste of a link with a title writes the title in double quotes', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(editor, '<p><a href="https://agentedapp.com" title="Home">AgentEd</a></p>', 'AgentEd');
    expect(editor.getMarkdown()).toBe('[AgentEd](https://agentedapp.com "Home")start');
  });

  it('a page that spells the delimiter attribute gets double quotes (#447)', () => {
    const editor = editorWith('start');
    editor.editor.commands.setTextSelection(1);
    paste(
      editor,
      '<p><a href="https://agentedapp.com" title="Home" data-link-title-delimiter="(">AgentEd</a></p>',
      'AgentEd',
    );
    expect(editor.getMarkdown()).toBe('[AgentEd](https://agentedapp.com "Home")start');
  });
});
