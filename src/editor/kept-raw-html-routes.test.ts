/**
 * #604 - raw HTML the editor lost on an unedited save, kept as its bytes: the
 * `details` route of #563 reaching four more spellings, a `video` carrier
 * believed, and a raw `code` with markup inside kept with its block.
 *
 * **Said first: what the reader sees is not observable here.** happy-dom draws
 * nothing, so whether a kept `details` looks as it did is the owner pass on
 * Windows. These rows hold the bytes an unedited save writes through the real
 * save assembly, the document the editor holds, and what an edit, an undo and
 * a paste do to both.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { lexMarkdown, markdownToHtml } from './markdown/parse';
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

/** Where `text` ends in the document, as a position. */
function positionAfter(instance: EditorInstance, text: string): number {
  let found = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text) + text.length;
    }
  });
  if (found < 0) throw new Error(`not found: ${text}`);
  return found;
}

/** Type `text` at `pos` as a keystroke does. */
function typeAt(instance: EditorInstance, pos: number, text: string): void {
  const { view } = instance.editor;
  view.dispatch(view.state.tr.insertText(text, pos));
}

/** Each spelling at the top level, inside a quote, and inside a list item. */
function inQuote(markdown: string): string {
  return markdown
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
    .concat('\n');
}

function inItem(markdown: string): string {
  const [first, ...rest] = markdown.replace(/\n$/, '').split('\n');
  return [`- item`, '', `  ${first}`, ...rest.map((line) => (line === '' ? '' : `  ${line}`))]
    .join('\n')
    .concat('\n');
}

/** An unedited save writes the file back, and a second save writes it again. */
async function holds(file: string): Promise<void> {
  const once = await openAndSaveUnedited(file);
  expect(once).toBe(file);
  expect(await openAndSaveUnedited(once)).toBe(once);
}

const L = '<details>\n<summary>More</summary>\n\n- a\n- b\n</details>\n';
const L_NESTED =
  '<details><summary>view</summary>\n\n * **Fixes**\n    - one ([`7db5738`](https://x.org/c/7db5738))\n    - two\n</details>\n';
const L_ORDERED =
  '<details>\n<summary>Steps</summary>\n\n1. Open it.\n2. Click `Save`.\n</details>\n';
const R =
  '<details>\n<summary>Notes</summary>\n\nSee [implement this][fs-blobs] here.\n\n</details>\n\n[fs-blobs]: https://example.com/blobs\n';
const S_ABOVE =
  '<details><summary>Example</summary><p>\n\n```js\nconst x = 1;\n```\n\n</p>\n</details>\n';
const S_UNDER =
  '<details>\n<summary>Cargo.toml</summary>\n\nText.\n\n</details>\n<p></p>\n\nAfter.\n';
const T = '<details><summary>Click to expand</summary>\n\nSome text\n</details>\n{% endif %}\n';
const N =
  '<details>\n<summary>Outer</summary>\n\nIntro.\n\n1. Build it:\n\n   <details>\n   <summary>Inner</summary>\n\n   Inner text.\n\n   </details>\n\n</details>\n';

describe('a details kept as its bytes, in the spellings #563 did not reach (#604)', () => {
  it.each([
    ['L, the end tag directly under a list line', L],
    ['L, under a nested list', L_NESTED],
    ['L, under an ordered list', L_ORDERED],
    ['R, a reference link inside, its definition outside', R],
    ['S, the end tag under a raw p end tag', S_ABOVE],
    ['S, the end tag over an empty raw p', S_UNDER],
    ['T, the end tag over a line of text', T],
    ['N, a details inside a details', N],
  ])('%s, at the top level', async (_label, file) => {
    await holds(file);
  });

  it.each([
    ['L', L],
    ['L, under a nested list', L_NESTED],
    ['S, the end tag under a raw p end tag', S_ABOVE],
    ['T', T],
  ])('%s, inside a quote', async (_label, file) => {
    await holds(inQuote(file));
  });

  it.each([
    ['L', L],
    ['L, under an ordered list', L_ORDERED],
    ['S, the end tag under a raw p end tag', S_ABOVE],
    ['N', N],
  ])('%s, inside a list item', async (_label, file) => {
    await holds(inItem(file));
  });

  it('R with the definition inside a quote, the region at the top level', async () => {
    await holds(R.replace('[fs-blobs]: ', '> [fs-blobs]: '));
  });

  it('R names its definition in another case and spacing', async () => {
    await holds(R.replace('[fs-blobs] here', '[FS-Blobs] here'));
  });
});

describe('a details that stays lost, as R-C2 records (#604, decision 3)', () => {
  it('X, opened in a list item and ended after the list', async () => {
    const file =
      '- Web browsers: disabled.\n  <details>\n    <summary>More</summary>\n\n  Why.\n\n</details>\n\nAfter.\n';
    const once = await openAndSaveUnedited(file);
    expect(once).not.toContain('<details>');
    expect(once).toContain('More');
    expect(await openAndSaveUnedited(once)).toBe(once);
  });

  it('opened inside a line of text', async () => {
    const file =
      '### Logs\n{% if h %}<details><summary>Click to expand</summary>\n\n{% endif -%}\n';
    const once = await openAndSaveUnedited(file);
    expect(once).not.toContain('<details>');
    expect(once).toContain('Click to expand');
    expect(await openAndSaveUnedited(once)).toBe(once);
  });
});

describe('a list item ends at a line opening an HTML block with an end tag (#604, K1b)', () => {
  // The element names of the CommonMark HTML block type 6, each as an end tag.
  const NAMES =
    'address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul'.split(
      ' ',
    );

  it.each(NAMES)('</%s> under an item is a block of its own', (name) => {
    const tokens = lexMarkdown(`- a\n</${name}>\n`);
    expect(tokens.map((t) => t.type)).toEqual(['list', 'html']);
    expect(tokens[1].raw).toBe(`</${name}>\n`);
  });

  it.each([
    ['a line of text', '- a\nb\n'],
    ['an end tag that is not a block element', '- a\n</span>\n'],
    ['an end tag indented into the item', '- a\n  </details>\n'],
  ])('%s stays a line of the item', (_label, markdown) => {
    const tokens = lexMarkdown(markdown);
    expect(tokens.map((t) => t.type)).toEqual(['list']);
  });
});

const VIDEO_SOURCE = '<video controls>\n  <source src="./v.mp4" type="video/mp4">\n</video>\n';
const VIDEO_POSTER =
  '<video controls>\n  <source src="./v.mp4">\n  <img src="./poster.png" alt="poster">\n</video>\n';
const VIDEO_TEXT =
  '<video controls>\n  <source src="./v.mp4">\n  Your browser does not play it.\n</video>\n';
const AUDIO = '<audio controls>\n  <source src="./a.ogg" type="audio/ogg">\n</audio>\n';

describe('a video kept as its carrier (#604, K2a, K2b and head 3)', () => {
  it.each([
    ['alone', '<video src="https://media.example/a.mp4"></video>\n'],
    [
      'between paragraphs',
      'One.\n\n<video src="./docs/demo.webm" controls muted></video>\n\nTwo.\n',
    ],
    ['inside a line', 'See <video src="./v.mp4"></video> here.\n'],
    ['alone, in a quote', '> <video src="./v.mp4"></video>\n'],
    ['alone, in a list item', '- item\n\n  <video src="./v.mp4"></video>\n'],
  ])('%s', async (_label, file) => {
    await holds(file);
  });

  it('is never built as a video element, nor handed to the parser as one (Q3)', () => {
    for (const file of [
      '<video src="https://media.example/a.mp4"></video>\n',
      'See <video src="./v.mp4"></video> here.\n',
      '<video controls>\n  <source src="./v.mp4" type="video/mp4">\n</video>\n',
      VIDEO_POSTER,
      VIDEO_TEXT,
      AUDIO,
    ]) {
      // A `source` left outside any media element, as `main` leaves it for a
      // block holding a poster or text, loads nothing: measured in Chromium.
      expect(markdownToHtml(file)).not.toMatch(/<(video|audio|track)/i);
      const instance = editorWith(file);
      expect(instance.editor.view.dom.querySelector('video, audio, source, track')).toBeNull();
    }
  });

  // A block of media is kept whole (K2b), and one holding a poster or text
  // keeps its bytes on the paragraph it is drawn as (head 3).
  it.each([
    ['with source children', VIDEO_SOURCE],
    ['with source children, in a quote', inQuote(VIDEO_SOURCE)],
    ['with source children, in a list item', inItem(VIDEO_SOURCE)],
    [
      'with a source and a track',
      '<video controls>\n  <source src="./v.mp4">\n  <track kind="captions" src="./v.vtt">\n</video>\n',
    ],
    ['an audio with a source', AUDIO],
    ['with a source and a poster', VIDEO_POSTER],
    ['with a source and a poster, in a quote', inQuote(VIDEO_POSTER)],
    ['with a source and fallback text', VIDEO_TEXT],
    ['with a source and fallback text, in a list item', inItem(VIDEO_TEXT)],
  ])('a block %s', async (_label, file) => {
    await holds(file);
  });

  it.each([
    ['the poster', VIDEO_POSTER, ['paragraph'], ['image']],
    ['the text', VIDEO_TEXT, ['paragraph'], []],
  ])('a block holding %s draws it as main does', (_label, file, blocks, images) => {
    const instance = editorWith(file);
    const kinds: string[] = [];
    const drawn: string[] = [];
    instance.editor.state.doc.descendants((node) => {
      if (node.isBlock && node.type.name !== 'doc') kinds.push(node.type.name);
      if (node.type.name === 'image') drawn.push(node.type.name);
    });
    expect(kinds).toEqual(blocks);
    expect(drawn).toEqual(images);
    if (file === VIDEO_TEXT)
      expect(instance.editor.state.doc.textContent).toContain('Your browser does not play it.');
  });

  it('a block of media alone hands the parser no source element (K2b)', () => {
    // Kept whole as one carrier, where its tags were carriers around a `source`
    // element the schema then dropped.
    for (const file of [VIDEO_SOURCE, AUDIO]) expect(markdownToHtml(file)).not.toMatch(/<source/i);
  });

  it('a picture holding sources alone is written as on main', async () => {
    const file = '<picture>\n  <source srcset="./a.webp" type="image/webp">\n</picture>\n';
    expect(await openAndSaveUnedited(file)).toBe('');
  });

  it('an edit in the fallback text lets the bytes go, and undo gives them back', async () => {
    const instance = editorWith(VIDEO_TEXT);
    typeAt(instance, positionAfter(instance, 'play it'), 'X');
    expect(await save(instance)).not.toBe(VIDEO_TEXT);
    instance.editor.commands.undo();
    expect(await save(instance)).toBe(VIDEO_TEXT);
  });
});

describe('a raw code with markup inside, kept with its block (#604, K4)', () => {
  it.each([
    ['a b inside, in a paragraph', 'call <code><b>x</b> y</code> here\n'],
    [
      'an i inside, in a paragraph over lines',
      'functions such as\n<code>is<i>foo</i></code> in UTF-8 locales\n',
    ],
    [
      'a link around a code holding a b',
      'Head to the <a\nhref="./docs/start.md"><code><b>Getting Started</b></code></a>.\n',
    ],
    [
      'a link inside, in a list',
      '- <code><a href="./a.ts">ApplyPatchTool</a></code>\n- <code><a href="./b.ts">Compacted</a></code>\n',
    ],
    [
      'a markdown link inside, in a list',
      '- Returns: <code>Promise&lt;[Response](#class-response)&gt;</code>\n',
    ],
    [
      'an i inside, in a loose list',
      '- <code>IsSerialized <i>(?boolean = false)</i></code>: see.\n\n- <code>Deserialized <i>(?type)</i></code>: see.\n',
    ],
    ['a b inside, in a quote', '> call <code><b>x</b> y</code> here\n'],
    ['inside a raw p, as #468 keeps it', '<p>call <code><b>x</b> y</code> here</p>\n'],
  ])('%s', async (_label, file) => {
    await holds(file);
  });

  it('a code holding text alone is written as the span it is drawn as', async () => {
    expect(await openAndSaveUnedited('call <code>x y</code> here\n')).toBe('call `x y` here\n');
  });
});

describe('examples 164, 166, 169 and 177 keep what R-C2 records (#604, decision 4)', () => {
  it.each([
    ['164, the class of an i', '<i class="foo">\n*bar*\n</i>\n', '*\\*bar\\**\n'],
    ['166, a del', '<del>\n*foo*\n</del>\n', '~~\\*foo\\*~~\n'],
    [
      '169, the language of a pre',
      '<pre language="haskell"><code>\nimport Text.HTML.TagSoup\n</code></pre>\nokay\n',
      '```\n\nimport Text.HTML.TagSoup\n```\nokay\n',
    ],
    [
      '177, a comment before text on its line',
      '<!-- foo -->*bar*\n*baz*\n',
      '\\*bar\\*\n\n*baz*\n',
    ],
  ])('%s', async (_label, file, written) => {
    const once = await openAndSaveUnedited(file);
    expect(once).toBe(written);
    expect(await openAndSaveUnedited(once)).toBe(once);
  });
});

describe('an edit (#604, option i of #468)', () => {
  it.each([
    ['L', L, 'a', 'More\n\n- aX\n- b\n'],
    [
      'R',
      R,
      'here',
      'Notes\n\nSee [implement this][fs-blobs] hereX.\n\n[fs-blobs]: https://example.com/blobs\n',
    ],
    ['T', T, 'Some text', 'Click to expand\n\nSome textX\n\n{% endif %}\n'],
    // An edit inside the inner one is inside the outer one too: both go.
    [
      'N, inside the inner one',
      N,
      'Inner text',
      'Outer\n\nIntro.\n\n1. Build it:\n\n   Inner\n\n   Inner textX.\n',
    ],
  ])('inside %s lets the bytes go, and undo gives them back', async (_label, file, at, written) => {
    const instance = editorWith(file);
    typeAt(instance, positionAfter(instance, at), 'X');
    expect(await save(instance)).toBe(written);
    instance.editor.commands.undo();
    expect(await save(instance)).toBe(file);
  });

  it('beside a video carrier keeps it', async () => {
    const file = 'One.\n\n<video src="./v.mp4" controls></video>\n\nTwo.\n';
    const instance = editorWith(file);
    typeAt(instance, positionAfter(instance, 'One'), 'X');
    expect(await save(instance)).toBe(file.replace('One.', 'OneX.'));
  });

  it('in one list item under K4 lets that item go and no other', async () => {
    const file = '- <code><a href="./a.ts">A</a></code>\n- <code><a href="./b.ts">B</a></code>\n';
    const instance = editorWith(file);
    typeAt(instance, positionAfter(instance, 'A'), 'X');
    expect(await save(instance)).toBe(
      '- [`A`](./a.ts)`X`\n- <code><a href="./b.ts">B</a></code>\n',
    );
    instance.editor.commands.undo();
    expect(await save(instance)).toBe(file);
  });

  it('Enter at the end of a kept details', async () => {
    const instance = editorWith(L);
    instance.editor
      .chain()
      .setTextSelection(positionAfter(instance, 'b'))
      .splitListItem('listItem')
      .run();
    // A new item is an edit: the details goes and the list is written as drawn.
    expect(await save(instance)).toBe('More\n\n- a\n- b\n-\n');
    instance.editor.commands.undo();
    expect(await save(instance)).toBe(L);
  });
});

/** Fire a paste carrying the given clipboard; the editor's own handler decides. */
function paste(instance: EditorInstance, data: Record<string, string>): boolean {
  const event = {
    clipboardData: { types: Object.keys(data), getData: (t: string) => data[t] ?? '', files: [] },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = instance.editor;
  return (
    view.someProp('handlePaste', (handler) =>
      handler(view, event, view.state.selection.content()),
    ) === true
  );
}

/** The clipboard HTML of a copy of the whole document from this window. */
function copyAll(instance: EditorInstance): { html: string; text: string } {
  instance.editor.commands.selectAll();
  const { view, state } = instance.editor;
  const { dom, text } = view.serializeForClipboard(state.selection.content());
  return { html: dom.innerHTML, text };
}

describe('a copy of a kept region (#604, R-C13)', () => {
  // The bytes of a block are never rendered, so no copy carries them.
  it.each([
    ['L', L],
    ['a code with markup', 'call <code><b>x</b> y</code> here\n'],
  ])('%s pasted inside one window carries no bytes', async (_label, file) => {
    const { html, text } = copyAll(editorWith(file));
    const target = editorWith('');
    if (!paste(target, { 'text/html': html, 'text/plain': text }))
      target.editor.view.pasteHTML(html);
    expect(await save(target)).not.toMatch(/<(details|code)/);
  });

  it('a video pasted inside one window keeps its carrier, as every carrier of #563 does', async () => {
    // A copy from this window keeps what the window put on its elements (R-C13).
    const { html, text } = copyAll(editorWith('One.\n\n<video src="./v.mp4"></video>\n'));
    const target = editorWith('');
    if (!paste(target, { 'text/html': html, 'text/plain': text }))
      target.editor.view.pasteHTML(html);
    expect(await save(target)).toBe('One.\n\n<video src="./v.mp4"></video>\n');
  });

  it.each([
    ['L', L],
    ['a code with markup', 'call <code><b>x</b> y</code> here\n'],
    ['a video', 'One.\n\n<video src="./v.mp4"></video>\n'],
  ])('%s pasted into another window', async (_label, file) => {
    const copied = copyAll(editorWith(file));
    const html = copied.html.replace(/data-agented-copy="[0-9a-f]+"/, 'data-agented-copy="0000"');
    const target = editorWith('');
    if (!paste(target, { 'text/html': html, 'text/plain': copied.text }))
      target.editor.view.pasteHTML(html);
    expect(await save(target)).not.toMatch(/<(details|code|video)/);
  });
});

const DL_LINKS =
  '<dl>\n<dt><a href="https://x.org">X</a></dt>\n<dd>desc <a href="y.md">y</a></dd>\n</dl>\n';
const DL_CODE =
  '<dl>\n<dt><a href="#Result">Result</a> ⇒ <code><a href="#Result">Result</a></code></dt>\n<dd><p>a no-op placeholder</p>\n</dd>\n</dl>\n';
const DL_BLOCKS =
  '<dl>\n<dt id="s">\n  <code><strong><a href="#s">schema</a></strong>: <span class="type">Schema</span></code></dt>\n\n<dd><p>Doc schema.</p>\n</dd>\n<dt id="M">\n  <h4>\n    <code><span class=keyword>class</span></code>\n    <a href="#M">M</a></h4>\n</dt>\n\n<dd><p>A parser.</p>\n</dd>\n</dl>\n';
const DL_AFTER_HEADING =
  '<h1>Module</h1>\n<p>About <a href="https://x.org">it</a>.</p>\n<h2>Documentation</h2>\n<dl>\n<dt id="a">\n  <code><strong><a href="#a">a</a></strong></code></dt>\n\n<dd><p>First.</p>\n</dd>\n</dl>\n\nAfter.\n';

describe('a raw dl kept as its bytes (#604, head 2)', () => {
  it.each([
    ['holding links', DL_LINKS],
    ['whose code holds HTML', DL_CODE],
    ['over several blocks', DL_BLOCKS],
    ['opening inside a block after a heading', DL_AFTER_HEADING],
  ])('%s, at the top level', async (_label, file) => {
    await holds(file);
  });

  it.each([
    ['holding links', DL_LINKS],
    ['over several blocks', DL_BLOCKS],
  ])('%s, inside a quote', async (_label, file) => {
    await holds(inQuote(file));
  });

  it.each([
    ['holding links', DL_LINKS],
    ['over several blocks', DL_BLOCKS],
  ])('%s, inside a list item', async (_label, file) => {
    await holds(inItem(file));
  });

  // The blocks `main` draws for each, measured at 49582c8: no paragraph of
  // carriers is added, where the route of K3r on the step zero added 11 in 00551.
  it.each([
    ['holding links', DL_LINKS, ['paragraph']],
    [
      'over several blocks',
      DL_BLOCKS,
      ['paragraph', 'paragraph', 'paragraph', 'heading', 'paragraph', 'paragraph', 'paragraph'],
    ],
    [
      'opening inside a block after a heading',
      DL_AFTER_HEADING,
      ['heading', 'paragraph', 'heading', 'paragraph', 'paragraph', 'paragraph', 'paragraph'],
    ],
  ])('%s is drawn in the blocks main draws', (_label, file, drawn) => {
    const kinds: string[] = [];
    editorWith(file).editor.state.doc.descendants((node) => {
      if (node.isBlock && node.type.name !== 'doc') kinds.push(node.type.name);
    });
    expect(kinds).toEqual(drawn);
  });

  it('an edit inside lets the bytes go, and undo gives them back', async () => {
    const instance = editorWith(DL_LINKS);
    typeAt(instance, positionAfter(instance, 'desc'), 'X');
    expect(await save(instance)).not.toBe(DL_LINKS);
    instance.editor.commands.undo();
    expect(await save(instance)).toBe(DL_LINKS);
  });

  it('an edit after it keeps its bytes', async () => {
    const instance = editorWith(DL_AFTER_HEADING);
    typeAt(instance, positionAfter(instance, 'After'), 'X');
    expect(await save(instance)).toBe(DL_AFTER_HEADING.replace('After.', 'AfterX.'));
  });

  it('a copy pasted into another window carries none of its tags', async () => {
    const copied = copyAll(editorWith(DL_LINKS));
    const html = copied.html.replace(/data-agented-copy="[0-9a-f]+"/, 'data-agented-copy="0000"');
    const target = editorWith('');
    if (!paste(target, { 'text/html': html, 'text/plain': copied.text }))
      target.editor.view.pasteHTML(html);
    expect(await save(target)).not.toMatch(/<\/?dl/);
  });

  it('a copy pasted inside one window carries the bytes of the region none, its tags as main does', async () => {
    // Each tag is a carrier of #563, which a copy from this window keeps
    // (R-C13), and the links between them are written as markdown: the same
    // bytes `main` writes for the same paste, measured at 49582c8.
    const copied = copyAll(editorWith(DL_LINKS));
    const target = editorWith('');
    if (!paste(target, { 'text/html': copied.html, 'text/plain': copied.text }))
      target.editor.view.pasteHTML(copied.html);
    expect(await save(target)).toBe(
      '<dl> <dt>[X](https://x.org)</dt> <dd>desc [y](y.md)</dd> </dl>\n',
    );
  });
});
