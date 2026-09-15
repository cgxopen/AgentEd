/**
 * #304 at the level the user meets it: the metadata split, on the whole path.
 *
 * Bytes on disk → `decodeFileText` → `loadMarkdown` → the editor →
 * `buildBundle` → `saveMarkdown`, then opened again. **Every row asserts what
 * the reopened document holds beside the bytes**, because R-C2 is the document
 * and not only the file (#300): one shape here, the rule document, used to
 * come back as metadata while its file held still.
 *
 * Measured on `e566993`, before the repair:
 *
 *  - a file holding only an opening and a closing delimiter was written back
 *    as an empty file, 0 bytes;
 *  - a document typed as rule, words, rule, words was saved `---` … `---`, and
 *    the next open put the words in the metadata panel and dropped the blank
 *    line below the second rule on the save after that;
 *  - a document whose rules were spelled `***` was rewritten `---` … `---` by an
 *    unedited save and read as metadata on the next open.
 */
import { describe, expect, it } from 'vitest';
import requirementsMd from '../../REQUIREMENTS.md?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import { decodeFileText } from '../platform/decode';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import blankFrontmatterMd from '../templates/blank-frontmatter.md?raw';
import meetingNoteMd from '../templates/meeting-note.md?raw';
import projectDocumentMd from '../templates/project-document.md?raw';
import templateReadmeMd from '../templates/readme.md?raw';
import { shouldShowFrontmatterPanel } from '../ui/frontmatter-panel';
import { buildBundle } from './bundle';
import { AppState } from './state';

const PATH = '/doc/notes.md';

/** A disk that records exactly what was written to it. */
function recordingIO(disk: Map<string, string>): PlatformIO {
  return {
    supportsMultiFile: true,
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
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async () => 'absent' as const,
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

/** The top-level nodes, with their text where they have any. */
function nodesOf(editor: EditorInstance): string[] {
  const nodes: string[] = [];
  editor.editor.state.doc.forEach((node) => {
    nodes.push(node.textContent ? `${node.type.name}:${node.textContent}` : node.type.name);
  });
  return nodes;
}

/** What one open showed, and what the save that followed it wrote. */
interface Opened {
  readonly metadata: string | null;
  readonly panel: boolean;
  readonly nodes: readonly string[];
  readonly written: string;
}

/** Hand the state a saved document, the way `applyBundle` does, and save it. */
async function saveFromEditor(editor: EditorInstance, state: AppState): Promise<string> {
  const result = await saveMarkdown(buildBundle(state, editor.getMarkdown), recordingIO(new Map()));
  return result.writtenText;
}

/** Open `text` from bytes, change nothing, save. */
async function openAndSave(text: string): Promise<Opened> {
  const disk = new Map([[PATH, decodeFileText(new TextEncoder().encode(text), PATH)]]);
  const loaded = await loadMarkdown(PATH, recordingIO(disk));
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(loaded.bundle.markdownBody);
  const state = new AppState();
  state.filePath = PATH;
  state.frontmatter = loaded.bundle.frontmatterRaw;
  state.lineConventions = loaded.bundle.lineConventions;
  state.byteOrderMark = loaded.bundle.byteOrderMark;
  try {
    return {
      metadata: loaded.bundle.frontmatterRaw,
      panel: shouldShowFrontmatterPanel(state),
      nodes: nodesOf(editor),
      written: await saveFromEditor(editor, state),
    };
  } finally {
    editor.destroy();
    host.remove();
  }
}

/** Three unedited open-and-save cycles, each opening what the last one wrote. */
async function threeCycles(text: string): Promise<readonly [Opened, Opened, Opened]> {
  const first = await openAndSave(text);
  const second = await openAndSave(first.written);
  const third = await openAndSave(second.written);
  return [first, second, third];
}

/** Feed text the way a keypress does, so the markdown input rules run. */
function type(editor: EditorInstance, text: string): void {
  for (const character of text) {
    const { view } = editor.editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

/** A key the way the key does it, so the keymaps see it. */
function press(editor: EditorInstance, key: string): void {
  const { view } = editor.editor;
  const event = new KeyboardEvent('keydown', { key });
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event));
  if (!handled) throw new Error(`nothing handled ${key}`);
}

/** Every cycle holds the same document, and the second and third saves move nothing. */
function expectSettled(cycles: readonly [Opened, Opened, Opened]): void {
  const [first, second, third] = cycles;
  expect(second.metadata).toBe(first.metadata);
  expect(second.panel).toBe(first.panel);
  expect(second.nodes).toEqual(first.nodes);
  expect(third.nodes).toEqual(first.nodes);
  expect(second.written).toBe(first.written);
  expect(third.written).toBe(second.written);
}

describe('an empty metadata block is a block (#304, half two)', () => {
  it('a file holding only an opening and a closing delimiter is written back as itself', async () => {
    // On `e566993` this wrote an empty file: `''` was tested as falsy, like `null`.
    const source = '---\n\n---\n';
    const cycles = await threeCycles(source);
    const [first, second] = cycles;
    expect(first.written).toBe(source);
    expect(first.metadata).toBe('');
    expect(first.panel).toBe(true);
    expect(second.metadata).toBe('');
    expect(second.panel).toBe(true);
    expectSettled(cycles);
  });

  it('the same file with Windows line endings', async () => {
    const source = '---\r\n\r\n---\r\n';
    const cycles = await threeCycles(source);
    expect(cycles[0].written).toBe(source);
    expect(cycles[1].panel).toBe(true);
    expectSettled(cycles);
  });

  it('an empty block above a document is kept, the panel shows, and the file is unchanged', async () => {
    const source = '---\n\n---\n# Notes\n\nSome text.\n';
    const cycles = await threeCycles(source);
    const [first, second] = cycles;
    expect(first.written).toBe(source);
    expect(second.metadata).toBe('');
    expect(second.panel).toBe(true);
    expect(second.nodes).toEqual(['heading:Notes', 'paragraph:Some text.']);
    expectSettled(cycles);
  });

  it('with a blank line below it, only that blank line goes, as R-C2 records', async () => {
    const cycles = await threeCycles('---\n\n---\n\n# Notes\n\nSome text.\n');
    expect(cycles[0].written).toBe('---\n\n---\n# Notes\n\nSome text.\n');
    expect(cycles[1].panel).toBe(true);
    expectSettled(cycles);
  });
});

describe('a document that opens with a rule is read back as that document (#304, half one)', () => {
  it('rule, words, rule, words typed into an empty document stay in the document', async () => {
    // The owner's manual steps, keystroke for keystroke.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host);
    editor.setMarkdown('');
    editor.editor.commands.focus();
    type(editor, '---');
    press(editor, 'Enter');
    type(editor, 'Some words');
    press(editor, 'Enter');
    type(editor, '---');
    press(editor, 'Enter');
    type(editor, 'More words');
    const state = new AppState();
    state.filePath = PATH;
    const saved = await saveFromEditor(editor, state);
    editor.destroy();
    host.remove();

    // The first rule takes the other spelling, and the blank line below the
    // second rule is written.
    expect(saved).toBe('***\n\nSome words\n\n---\n\nMore words\n');
    const cycles = await threeCycles(saved);
    const [reopened] = cycles;
    expect(reopened.metadata).toBeNull();
    expect(reopened.panel).toBe(false);
    expect(reopened.nodes).toEqual([
      'horizontalRule',
      'paragraph:Some words',
      'horizontalRule',
      'paragraph:More words',
    ]);
    expect(reopened.written).toBe(saved);
    expectSettled(cycles);
  });

  it.each([
    '***',
    '___',
    '* * *',
  ])('a file whose rules are spelled %j is not turned into a metadata block', async (rule) => {
    // On `e566993` an unedited save wrote both rules `---` and the next open
    // took the words out of the document.
    const cycles = await threeCycles(`${rule}\n\nWords\n\n${rule}\n\nAfter\n`);
    const [first] = cycles;
    expect(first.nodes).toEqual([
      'horizontalRule',
      'paragraph:Words',
      'horizontalRule',
      'paragraph:After',
    ]);
    expect(first.written).toBe('***\n\nWords\n\n---\n\nAfter\n');
    expect(cycles[1].metadata).toBeNull();
    expectSettled(cycles);
  });

  it('blank lines above the first rule do not make the document a metadata block on save', async () => {
    const cycles = await threeCycles('\n\n---\n\nWords\n\n---\n\nAfter\n');
    expect(cycles[0].metadata).toBeNull();
    expect(cycles[0].written).toBe('***\n\nWords\n\n---\n\nAfter\n');
    expectSettled(cycles);
  });

  it('the same document with Windows line endings keeps them', async () => {
    const source = '***\r\n\r\nWords\r\n\r\n---\r\n\r\nAfter\r\n';
    const cycles = await threeCycles(source);
    expect(cycles[0].written).toBe(source);
    expect(cycles[1].nodes).toEqual([
      'horizontalRule',
      'paragraph:Words',
      'horizontalRule',
      'paragraph:After',
    ]);
    expectSettled(cycles);
  });

  it.each([
    ['one rule and no second', '---\n\nText\n'],
    ['a metadata block and then two rules', '---\ntitle: x\n---\n---\n\nWords\n\n---\n\nAfter\n'],
    ['an empty metadata block and then two rules', '---\n\n---\n---\n\nWords\n\n---\n\nAfter\n'],
  ])('%s is written exactly as it was', async (_name, source) => {
    const cycles = await threeCycles(source);
    expect(cycles[0].written).toBe(source);
    expectSettled(cycles);
  });

  it('a paragraph of three hyphens is written escaped, so a body can only open with --- as a rule', async () => {
    // The fact the respelling rests on: the first line it replaces is a rule.
    const source = '\\---\n\nWords\n\n---\n\nAfter\n';
    const cycles = await threeCycles(source);
    expect(cycles[0].nodes).toEqual([
      'paragraph:---',
      'paragraph:Words',
      'horizontalRule',
      'paragraph:After',
    ]);
    expect(cycles[0].written).toBe(source);
    expectSettled(cycles);
  });
});

describe('what #304 does not reach, pinned so that a change to it is announced', () => {
  it('a file already on disk spelled --- … --- is still read as metadata', async () => {
    // The written limitation. `gray-matter` and remark read it the same way.
    const cycles = await threeCycles('---\n\nWords\n\n---\n\nAfter\n');
    expect(cycles[0].metadata).toBe('\nWords\n');
    expect(cycles[0].nodes).toEqual(['paragraph:After']);
    expect(cycles[0].written).toBe('---\n\nWords\n\n---\nAfter\n');
    expectSettled(cycles);
  });
});

describe('R-C2 exception: a horizontal rule is written with three hyphens', () => {
  it.each([
    '***',
    '___',
    '* * *',
    '- - -',
    '_ _ _',
    '-----',
    '*****',
    '   ***',
  ])('a rule spelled %j is written back as ---, and then holds still', async (rule) => {
    const cycles = await threeCycles(`Before\n\n${rule}\n\nAfter\n`);
    const [first] = cycles;
    expect(first.nodes).toEqual(['paragraph:Before', 'horizontalRule', 'paragraph:After']);
    expect(first.written).toBe('Before\n\n---\n\nAfter\n');
    expectSettled(cycles);
  });

  it('is recorded in REQUIREMENTS', () => {
    expect(requirementsMd).toContain(
      '**Known exception — a horizontal rule is written with three hyphens.**',
    );
  });
});

/** The same text with its line endings as `\r\n`. */
const crlf = (text: string) => text.replace(/\n/g, '\r\n');

/**
 * What a real block's unedited save writes: the source, less the one blank
 * line R-C2 records as lost directly below the block (#84).
 */
function expectedBytes(source: string, metadata: string): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const block = `---${eol}${metadata.replace(/\n/g, eol)}${eol}---${eol}`;
  if (!source.startsWith(block)) throw new Error('the fixture does not open with its block');
  const rest = source.slice(block.length);
  return block + (rest.startsWith(eol) ? rest.slice(eol.length) : rest);
}

const REAL_BLOCKS: ReadonlyArray<readonly [string, string, string]> = [
  ['one key', '---\ntitle: Notes\n---\n\n# Notes\n', 'title: Notes'],
  [
    'many keys',
    '---\ntitle: Notes\nauthor: Ana\ndate: 2026-09-15\ntags: [a, b]\ndraft: false\n---\n\n# Notes\n',
    'title: Notes\nauthor: Ana\ndate: 2026-09-15\ntags: [a, b]\ndraft: false',
  ],
  ['a value holding ---', '---\ntitle: before --- after\n---\n\nBody\n', 'title: before --- after'],
  [
    'a quoted value of ---, first',
    '---\nsummary: "---"\ntitle: x\n---\n\nBody\n',
    'summary: "---"\ntitle: x',
  ],
  [
    'a block-scalar line of ---',
    '---\nnotes: |\n  ---\n  kept\ntitle: x\n---\n\nBody\n',
    'notes: |\n  ---\n  kept\ntitle: x',
  ],
  [
    'a value holding a colon',
    '---\ntitle: "Part 2: the sequel"\nurl: https://example.com/a:b\n---\n\nBody\n',
    'title: "Part 2: the sequel"\nurl: https://example.com/a:b',
  ],
  [
    'an unquoted value holding a colon',
    '---\ntitle: Part 2: the sequel\n---\n\nBody\n',
    'title: Part 2: the sequel',
  ],
  [
    'a blank line inside',
    '---\ntitle: Notes\n\nauthor: Ana\n---\n\nBody\n',
    'title: Notes\n\nauthor: Ana',
  ],
  [
    'a first key with an empty value',
    '---\ntags:\n  - a\n  - b\n---\n\nBody\n',
    'tags:\n  - a\n  - b',
  ],
  ['a quoted key', '---\n"title": Notes\n---\n\nBody\n', '"title": Notes'],
  ['no body', '---\ntitle: Notes\n---\n', 'title: Notes'],
  [
    'a comment as the first line',
    '---\n# a comment\ntitle: Notes\n---\n\nBody\n',
    '# a comment\ntitle: Notes',
  ],
  ['a blank line as the first line', '---\n\ntitle: Notes\n---\n\nBody\n', '\ntitle: Notes'],
];

describe('a real metadata block is read, shown and written back (#304, the regression half)', () => {
  it.each(
    REAL_BLOCKS.flatMap(([name, source, metadata]) => [
      [`${name}, LF`, source, metadata] as const,
      [`${name}, CRLF`, crlf(source), metadata] as const,
    ]),
  )('%s', async (_name, source, metadata) => {
    const cycles = await threeCycles(source);
    const [first] = cycles;
    expect(first.metadata).toBe(metadata);
    // Newline-only whatever the file used: the panel is not where the file's
    // line conventions live (#79).
    expect(first.metadata).not.toContain('\r');
    expect(first.panel).toBe(true);
    expect(first.written).toBe(expectedBytes(source, metadata));
    expectSettled(cycles);
  });

  it.each([
    ['LF', blankFrontmatterMd],
    ['CRLF', crlf(blankFrontmatterMd)],
  ])('the Blank + metadata template, which AgentEd writes, keeps its block (%s)', async (_name, source) => {
    // Its body wraps a line, so the whole file also meets the soft-break
    // exception; the block is asserted to the byte, the rest to settling.
    const metadata = 'title: Untitled\ndescription:\nauthor:\ndate:\ntags: []';
    const cycles = await threeCycles(source);
    const [first] = cycles;
    expect(first.metadata).toBe(metadata);
    expect(first.panel).toBe(true);
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    expect(
      first.written.startsWith(`---${eol}${metadata.replace(/\n/g, eol)}${eol}---${eol}# Untitled`),
    ).toBe(true);
    expectSettled(cycles);
  });

  it.each([
    ['readme', templateReadmeMd],
    ['project document', projectDocumentMd],
    ['meeting note', meetingNoteMd],
  ])('the %s template has no block, shows no panel, and settles', async (_name, source) => {
    const cycles = await threeCycles(source);
    expect(cycles[0].metadata).toBeNull();
    expect(cycles[0].panel).toBe(false);
    expect(cycles[0].written.startsWith('#')).toBe(true);
    expectSettled(cycles);
  });
});
