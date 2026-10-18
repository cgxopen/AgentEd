/**
 * #563 - raw HTML the editor cannot hold, kept as its bytes, and `sup`, `sub`
 * and `kbd` held as marks.
 *
 * **Said first: what the reader sees is not observable here.** happy-dom draws
 * nothing, so whether an exponent looks like one, and whether a kept anchor
 * leaves nothing visible, is the owner pass on Windows. What these rows hold is
 * the bytes an unedited save writes through the real save assembly, what the
 * editor's document holds, and what an edit, a paste and an undo do to both.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const DOCUMENT_PATH = '/doc/notes.md';

function recordingIO(disk: Map<string, string>): PlatformIO {
  return {
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

let open: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  open.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of open) instance.destroy();
  open = [];
  document.body.innerHTML = '';
});

/** The bytes the save assembly writes for what `instance` holds now. */
async function save(instance: EditorInstance): Promise<string> {
  const disk = new Map<string, string>();
  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  const result = await saveMarkdown(buildDocument(state, instance.getMarkdown), recordingIO(disk));
  return result.writtenText;
}

/** Open `text` as a file, change nothing, save, and return what reached the disk. */
async function openAndSaveUnedited(text: string): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);
  const instance = editorWith(loaded.document.markdownBody);
  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;
  const result = await saveMarkdown(buildDocument(state, instance.getMarkdown), io);
  return result.writtenText;
}

/** Where `text` starts in the document, as a position. */
function positionOf(instance: EditorInstance, text: string): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text);
    }
  });
  if (found < 0) throw new Error(`not found: ${text}`);
  return found;
}

/** Type `text` at `pos` as a keystroke does: the marks are the position's own. */
function typeAt(instance: EditorInstance, pos: number, text: string): void {
  const { view } = instance.editor;
  view.dispatch(view.state.tr.insertText(text, pos));
}

describe('kept as bytes: an unedited save writes the file back and holds still (#563)', () => {
  it.each([
    ['an anchor with a name', '<a name="intro"></a>\n\n## Intro\n\nSee [it](#intro).\n'],
    ['an anchor with an id', '<a id="intro"></a>\n\n## Intro\n\nSee [it](#intro).\n'],
    ['an anchor inside a heading', '## <a name="intro"></a>Intro\n\nSee [it](#intro).\n'],
    ['an anchor around text, inline', 'See <a name="x">the place</a> here.\n'],
    ['the tags of a span', 'Text <span style="color:red">red</span> here.\n'],
    ['an unknown element around text', 'Words <titlex>a</titlex> end.\n'],
    ['a custom element alone', 'Foo <responsive-image src="foo.jpg" />\n'],
    ['a processing instruction, inline', 'foo <?php echo $a; ?>\n'],
    ['a declaration', '<!DOCTYPE html>\n'],
    ['CDATA, inline', 'foo <![CDATA[>&<]]>\n'],
    ['an empty div with attributes', '<div id="foo"\n  class="bar">\n</div>\n'],
    ['a block comment indented by one space', ' <!-- YAML\nadded: v1\n-->\n\nText.\n'],
    ['a block comment indented by three spaces', '   <!-- note -->\n\nText.\n'],
    [
      'sup, sub and kbd',
      'The value is 2<sup>n - 1</sup>, H<sub>2</sub>O, <kbd>Ctrl</kbd>+<kbd>S</kbd>.\n',
    ],
    [
      'a details holding several blocks',
      'Before.\n\n<details>\n<summary>More</summary>\n\nFirst.\n\n- a\n- b\n\n</details>\n\nAfter.\n',
    ],
    ['a details whose start tag stands alone', '<details>\n\nFirst.\n\nSecond.\n\n</details>\n'],
    [
      'a details whose summary follows a blank line',
      '<details>\n\n<summary>Members</summary>\n\n#### Members\n\n* one\n\n</details>\n',
    ],
    [
      'an anchor inside a details',
      '<details>\n<summary>Steps</summary>\n\n* <a name="metadata"></a>Change it.\n\n</details>\n',
    ],
  ])('%s', async (_label, file) => {
    const once = await openAndSaveUnedited(file);
    expect(once).toBe(file);
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it('a comment after other markup in its block is kept, and the markup with it', async () => {
    // The `p` keeps its bytes since #572, as a raw block the editor draws as a
    // paragraph; the comment is #563.
    const once = await openAndSaveUnedited('<p>x</p>\n<!-- end -->\n\nText.\n');
    expect(once).toBe('<p>x</p>\n<!-- end -->\n\nText.\n');
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it('an anchor directly above a heading stays directly above it (#568)', async () => {
    const file = '<a name="intro"></a>\n## Intro\n';
    expect(await openAndSaveUnedited(file)).toBe(file);
  });
});

describe('an indented block comment is a comment (#245, repaired by #563)', () => {
  // Its bytes would survive without the repair too, carried as raw HTML; what
  // the repair gives is the comment itself, drawn as the mark #245 draws, with
  // its note on hover, rather than bytes nobody sees.
  it.each([
    ['one space', ' <!-- note -->\n\nText.\n'],
    ['three spaces', '   <!-- note -->\n\nText.\n'],
  ])('indented by %s, it is held as a comment', (_label, file) => {
    const instance = editorWith(file);
    const kinds: string[] = [];
    instance.editor.state.doc.descendants((node) => {
      if (node.isInline && !node.isText) kinds.push(node.type.name);
    });
    expect(kinds).toEqual(['markdownComment']);
  });
});

describe('what is never taken (#563)', () => {
  it('an a with an href and text stays a link', () => {
    const instance = editorWith('See <a href="https://example.com">the site</a> here.\n');
    expect(instance.editor.getHTML()).toContain('href="https://example.com"');
    expect(instance.editor.state.doc.textContent).toBe('See the site here.');
    const kept: string[] = [];
    instance.editor.state.doc.descendants((node) => {
      if (node.type.name === 'keptRawHtml') kept.push(String(node.attrs.bytes));
    });
    expect(kept).toEqual([]);
  });

  it('an a with an href and no text keeps the loss R-C2 records', async () => {
    expect(await openAndSaveUnedited('foo <a href="x">\n')).toBe('foo\n');
  });

  it('a div holding text whose blocks read back the same keeps its bytes (#572)', async () => {
    expect(await openAndSaveUnedited('<div>\n*foo*\n\n*bar*\n')).toBe('<div>\n*foo*\n\n*bar*\n');
  });

  it('a comment opening the text of its block keeps the loss it had, and holds still', async () => {
    const once = await openAndSaveUnedited('<!-- foo -->*bar*\n*baz*\n');
    expect(once).toBe('\\*bar\\*\n\n*baz*\n');
    expect(await openAndSaveUnedited(once)).toBe(once);
  });
});

describe('an edit (#563)', () => {
  it('beside kept bytes keeps them', async () => {
    const instance = editorWith('Text <span>red</span> here.\n');
    typeAt(instance, positionOf(instance, ' here') + ' here'.length, '!');
    expect(await save(instance)).toBe('Text <span>red</span> here!.\n');
  });

  it('inside a details lets it go, and undo gives the bytes back', async () => {
    const file = '<details>\n<summary>More</summary>\n\nFirst.\n\nSecond.\n\n</details>\n';
    const instance = editorWith(file);
    typeAt(instance, positionOf(instance, 'First.') + 'First'.length, 'X');
    expect(await save(instance)).toBe('More\n\nFirstX.\n\nSecond.\n');
    instance.editor.commands.undo();
    expect(await save(instance)).toBe(file);
  });

  it('outside a details keeps its bytes', async () => {
    const file = '<details>\n<summary>More</summary>\n\nFirst.\n\n</details>\n\nAfter.\n';
    const instance = editorWith(file);
    typeAt(instance, positionOf(instance, 'After.') + 'After'.length, 'X');
    expect(await save(instance)).toBe(file.replace('After.', 'AfterX.'));
  });

  /**
   * Half a pair, measured as the brief of #563 asks: the closing tag of a span
   * removed, then the opening one. Each is an atom a Backspace removes like a
   * character, and the file gets the tag that is left, alone.
   */
  it.each([
    ['the closing tag of a span', '</span>', 'Text <span style="color:red">red here.\n'],
    ['the opening tag of a span', '<span style="color:red">', 'Text red</span> here.\n'],
  ])('deleting %s writes the other alone', async (_label, gone, written) => {
    const instance = editorWith('Text <span style="color:red">red</span> here.\n');
    let at = -1;
    instance.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'keptRawHtml' && node.attrs.bytes === gone) at = pos;
    });
    expect(at).toBeGreaterThan(0);
    instance.editor.view.dispatch(instance.editor.state.tr.delete(at, at + 1));
    expect(await save(instance)).toBe(written);
  });
});

describe('sup, sub and kbd are marks the text typed at their end does not join (#563)', () => {
  it.each([
    [
      'an exponent',
      'The value is 2<sup>n</sup> here.\n',
      'n',
      'The value is 2<sup>n</sup>X here.\n',
    ],
    ['an index', 'Water is H<sub>2</sub> here.\n', '2', 'Water is H<sub>2</sub>X here.\n'],
    ['a key', 'Press <kbd>S</kbd> here.\n', 'S', 'Press <kbd>S</kbd>X here.\n'],
  ])('typing at the end of %s is plain', async (_label, file, inside, written) => {
    const instance = editorWith(file);
    typeAt(instance, positionOf(instance, inside) + inside.length, 'X');
    expect(await save(instance)).toBe(written);
  });

  it('typing inside one stays inside', async () => {
    const instance = editorWith('2<sup>nm</sup>\n');
    typeAt(instance, positionOf(instance, 'nm') + 1, 'X');
    expect(await save(instance)).toBe('2<sup>nXm</sup>\n');
  });
});

/** Fire a paste carrying the given clipboard; the editor's own handler decides. */
function paste(instance: EditorInstance, data: Record<string, string>): void {
  const event = {
    clipboardData: { types: Object.keys(data), getData: (t: string) => data[t] ?? '', files: [] },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = instance.editor;
  view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
}

describe('a paste (#563, R-C13)', () => {
  const RICH = '<p>2<sup>n - 1</sup>, H<sub>2</sub>O and <kbd>Ctrl</kbd></p>';
  const TEXT = '2n - 1, H2O and Ctrl';

  it('of rich HTML keeps sup, sub and kbd, and the file gets the tags', async () => {
    const instance = editorWith('');
    paste(instance, { 'text/html': RICH, 'text/plain': TEXT });
    expect(await save(instance)).toBe('2<sup>n - 1</sup>, H<sub>2</sub>O and <kbd>Ctrl</kbd>\n');
  });

  it('of plain text creates none', async () => {
    const instance = editorWith('');
    paste(instance, { 'text/plain': TEXT });
    expect(await save(instance)).toBe(`${TEXT}\n`);
  });

  it('with Ctrl+Shift+V creates none', async () => {
    const instance = editorWith('');
    (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt =
      Date.now();
    paste(instance, { 'text/html': RICH, 'text/plain': TEXT });
    expect(await save(instance)).toBe(`${TEXT}\n`);
  });
});

describe('the walk that marks kept bytes is bounded (#578 review)', () => {
  it('marks an anchor nested within the bound and none past it', () => {
    const nested = (depth: number) => `${'> '.repeat(depth)}<a name="x"></a>\n`;
    const kinds = (markdown: string) => {
      const found: string[] = [];
      editorWith(markdown).editor.state.doc.descendants((node) => {
        if (node.type.name === 'keptRawHtml') found.push(node.type.name);
      });
      return found;
    };
    expect(kinds(nested(10))).toEqual(['keptRawHtml']);
    expect(kinds(nested(260))).toEqual([]);
  });
});
