/**
 * #744: a strikethrough written with one tilde, and a rule spelled otherwise
 * than `---`, keep their spelling on an unedited save, through the real open
 * and save of the document actions against an in-memory disk.
 *
 * Measured at `7a187b1`, before the repair: every single-tilde strike was
 * written with two tildes and every rule `---`, in 24 and 92 files of the
 * corpus, the two R-C2 exceptions of #85 and #304. `marked` hands both
 * spellings over in the token `raw`; the strike mark and the rule node held
 * no memory of them, so the serializer wrote the spelling it writes unasked.
 * See `strike-delimiter.ts` and `rule-spelling.ts`.
 *
 * What the person writes keeps the spellings of before, and the two places
 * that write a rule `***` on purpose, #304 and #606, still decide.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { markdownToHtml } from '../editor/markdown/parse';
import type { PredictablePasteStorage } from '../editor/paste';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

let disk: Map<string, string>;

const io: PlatformIO = {
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async (path: string) => {
    const text = disk.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  saveFile: async (path: string, content: string) => {
    disk.set(path, content);
  },
  readSnapshot: async (path: string): Promise<FileSnapshot> => {
    const text = disk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => null,
  installCloseGuard: async () => {},
  readBinary: async (path: string) => {
    throw new Error(`no such file: ${path}`);
  },
  writeBinary: async () => {},
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

let state: AppState;
let editor: EditorInstance;

const reporter: ErrorReporter = {
  silent: () => {},
  toast: () => {},
  dialog: async (message: string, _e: unknown, title?: string) => {
    throw new Error(`unexpected failure dialog: ${title}: ${message}`);
  },
};

const PATH = '/doc/spelling.md';

function makeActions(): DocumentActions {
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor = createEditor(host);
  (editor.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  const ctx = {
    state,
    reporter,
    editor: editor.editor,
    getMarkdown: editor.getMarkdown,
    setMarkdown: editor.setMarkdown,
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

/** Open `text` from disk, run `edit` on the editor, save, and return what was written. */
async function saved(text: string, edit: (instance: EditorInstance) => void = () => {}) {
  disk.set(PATH, text);
  const actions = makeActions();
  await actions.openFilePath(PATH);
  edit(editor);
  state.setModified(true);
  await actions.handleSave();
  return disk.get(PATH) ?? '';
}

/** The top-level blocks a markdown text reads as, by tag, the way GitHub draws them. */
function blocksOf(markdown: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = markdownToHtml(markdown, { keepRawHtml: false });
  return Array.from(host.children).map((element) => element.nodeName.toLowerCase());
}

/** The position just before the first character of `text`. */
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

/** Delete the paragraph whose whole text is `text`. */
function deleteParagraph(instance: EditorInstance, text: string): void {
  let from = -1;
  let to = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.type.name === 'paragraph' && node.textContent === text) {
      from = pos;
      to = pos + node.nodeSize;
    }
  });
  instance.editor.chain().deleteRange({ from, to }).run();
}

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

beforeEach(() => {
  disk = new Map();
  state = new AppState();
  clearImages();
  document.body.innerHTML = '';
});

describe('an unedited save keeps the spelling of the file (#744)', () => {
  it.each([
    ['a single-tilde strike', 'A ~gone~ word.\n'],
    ['single-tilde strikes inside a word and beside a two-tilde one', 'x~a~y and ~b~ and ~~c~~\n'],
    ['two tildes read as one strike, as GitHub reads them', 'About ~57 MB), cache (~2 s).\n'],
    ['a strike holding a tilde after a space', 'Reads ~50k and ~10k writes~ a second.\n'],
    ['a single-tilde strike in a cell', '| a |\n| - |\n| ~b~ |\n'],
    ['a rule of three stars', 'Before\n\n***\n\nAfter\n'],
    ['a rule of three underscores', 'Before\n\n___\n\nAfter\n'],
    ['a rule of spaced stars', 'Before\n\n* * *\n\nAfter\n'],
    ['a rule of spaced hyphens', 'Before\n\n- - -\n\nAfter\n'],
    ['a rule of spaced underscores', 'Before\n\n_ _ _\n\nAfter\n'],
    ['a longer run of hyphens', 'Before\n\n----------\n\nAfter\n'],
    ['a longer run of stars', 'Before\n\n*****\n\nAfter\n'],
    ['a longer run of underscores', 'Before\n\n______\n\nAfter\n'],
    ['an indented rule', 'Before\n\n   ***\n\nAfter\n'],
    ['a rule in a quote and in an item', '> * * *\n\n- a\n\n  ___\n'],
    ['a rule directly under a paragraph', 'Text.\n***\n'],
  ])('%s', async (_label, text) => {
    expect(await saved(text)).toBe(text);
  });

  it('the owner test file of 2026-11-16, byte for byte', async () => {
    const text =
      '# Round-trip test\r\n\r\n* star item one\r\n* star item two\r\n\r\n- dash item one\r\n' +
      '- dash item two\r\n\r\nSome _underscore emphasis_ and **strong** text, and ~single tilde~.' +
      '\r\n\r\n| Name   | Role     | Count |\r\n| :----- | :------: | ----: |\r\n' +
      '| alpha  | editor   |     1 |\r\n| beta   | reviewer |    22 |\r\n\r\n***\r\n\r\n' +
      'Last paragraph, to be edited.';
    expect(text.length).toBe(326);
    expect(await saved(text)).toBe(text);
  });

  it('holds still on a second save', async () => {
    const text = 'A ~gone~ word.\n\n- - -\n\n_____\n';
    const first = await saved(text);
    expect(await saved(first)).toBe(first);
  });
});

describe('the two rules R-C2 writes as *** on purpose still decide', () => {
  it('a document with no metadata block whose first line would open one (#304)', async () => {
    // A rule the person inserts above the first block carries no spelling, and
    // the rule the file spelled `---` further down is still `---`.
    const written = await saved('Words\n\n---\n\nAfter\n', (instance) => {
      instance.editor.chain().setTextSelection(1).setHorizontalRule().run();
    });
    expect(written.startsWith('***\n')).toBe(true);
    expect(written.endsWith('Words\n\n---\n\nAfter\n')).toBe(true);
  });

  it('a carried spelling that begins with three hyphens opens no block', async () => {
    const text = '-----\n\nWords\n\n---\n\nAfter\n';
    expect(await saved(text)).toBe(text);
    expect(blocksOf(text)).toEqual(['hr', 'p', 'hr', 'p']);
  });

  it.each([
    ['a dash item, spelled with hyphens', '- a\n\n  - - -\n', '- ***\n'],
    ['a star item, spelled with stars', '* a\n\n  ***\n', '* ---\n'],
    ['a dash item, spelled with underscores', '- a\n\n  ___\n', '- ___\n'],
    ['a plus item, indented', '+ a\n\n     ***\n', '+ ***\n'],
  ])('a rule brought to open %s by an edit (#606)', async (_label, text, expected) => {
    const written = await saved(text, (instance) => deleteParagraph(instance, 'a'));
    expect(written).toBe(expected);
    expect(blocksOf(written)).toEqual(['ul']);
  });

  it('a run of hyphens brought under a paragraph by an edit is written a blank line apart', async () => {
    const written = await saved('# H\n-----\n', (instance) => {
      instance.editor.chain().setTextSelection(2).setParagraph().run();
    });
    expect(written).toBe('H\n\n-----\n');
    expect(blocksOf(written)).toEqual(['p', 'hr']);
  });
});

describe('a file that spells the attribute in its own HTML is not believed (#447)', () => {
  it.each([
    ['a strike', 'a <s data-strike-delimiter="~">x</s> b\n', 'a ~~x~~ b\n'],
    ['a rule', 'a\n\n<hr data-rule-spelling="%2A%2A%2A">\n\nb\n', 'a\n\n---\n\nb\n'],
  ])('%s', async (_label, text, expected) => {
    expect(await saved(text)).toBe(expected);
  });
});

describe('what the person writes keeps the spellings of before', () => {
  it('typing inside a single-tilde strike keeps the one tilde', async () => {
    const written = await saved('A ~gone~ word.\n', (instance) => {
      instance.editor
        .chain()
        .setTextSelection(positionOf(instance, 'one'))
        .insertContent('X')
        .run();
    });
    expect(written).toBe('A ~gXone~ word.\n');
  });

  it('a tilde typed into it writes two, and the strike reads back whole', async () => {
    const written = await saved('A ~gone~ word.\n', (instance) => {
      instance.editor.chain().setTextSelection(positionOf(instance, 'ne')).insertContent('~').run();
    });
    expect(written).toBe('A ~~go~ne~~ word.\n');
    expect(markdownToHtml(written)).toContain('<del>go~ne</del>');
  });

  it('a strike made with the toolbar writes two tildes', async () => {
    const written = await saved('A ~gone~ word.\n', (instance) => {
      const at = positionOf(instance, 'word');
      instance.editor
        .chain()
        .setTextSelection({ from: at, to: at + 4 })
        .toggleStrike()
        .run();
    });
    expect(written).toBe('A ~gone~ ~~word~~.\n');
  });

  it('a rule inserted with the toolbar writes three hyphens', async () => {
    const written = await saved('A\n\n***\n\nB\n', (instance) => {
      instance.editor
        .chain()
        .setTextSelection(positionOf(instance, 'B') + 1)
        .setHorizontalRule()
        .run();
    });
    expect(written).toBe('A\n\n***\n\nB\n\n---\n');
  });

  it.each([
    [
      'a strike AgentEd renders',
      { html: '<p><s data-strike-delimiter="~">x</s></p>', text: 'x' },
      '~~x~~',
    ],
    ['a strike spelled with one tilde, as text', { text: '~x~' }, '~~x~~'],
    ['a rule AgentEd renders', { html: '<hr data-rule-spelling="%2A%2A%2A">', text: '' }, '---'],
    ['a rule spelled with stars, as text', { text: '***' }, '---'],
  ])('a paste of %s carries no spelling', async (_label, clipboard, expected) => {
    const written = await saved('Start\n', (instance) => {
      instance.editor.commands.setTextSelection(positionOf(instance, 'Start') + 5);
      instance.editor.commands.splitBlock();
      paste(instance, clipboard);
    });
    expect(written).toContain(expected);
    expect(written).not.toContain(expected === '---' ? '***' : '~x~ ');
    expect(written).not.toMatch(/(^|[^~])~x~([^~]|$)/);
  });
});
