/**
 * The R-C12 badges at the level the user reaches them: a document
 * opened, a metadata block emptied in the panel, a document replaced.
 *
 * **Driven from markdown in, through the ordinary open path.** The
 * editor is real, the state is real, and `openFilePath` is the same
 * function the sidebar, the context popover and File → Open all call —
 * so what is asserted is that opening a document with a metadata block
 * lights the badge, not that a function called with `'title: x'` lights
 * it. A test that set `state.frontmatter` directly and called a refresh
 * would assert nothing about the route it claims to cover, which is the
 * shape #146 was written against.
 *
 * The wiring under test is `main.ts`'s: «Images» on the editor's
 * transaction event, «Metadata» on `onFrontmatterChange`. Wired to
 * `update` instead — the obvious choice — the badge would be right for
 * every keystroke and wrong for every document opened, because
 * `setContent` carries `preventUpdate` and `update` is not emitted for
 * it. That is what the open-path tests below catch.
 *
 * The wiring is restated in `rig()` rather than imported, because
 * `main.ts` is the application entry point and importing it would boot
 * the whole product. `rig()` is those two subscriptions and nothing
 * else; the badge module's own contract is covered in
 * `src/ui/document-badges.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { setupDocumentBadges } from '../ui/document-badges';
import { setupFrontmatterPanel, shouldShowFrontmatterPanel } from '../ui/frontmatter-panel';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

const PLAIN = '/doc/plain.md';
const WITH_META = '/doc/meta.md';
const WITH_IMAGE = '/doc/image.md';
const WITH_BOTH = '/doc/both.md';

const PLAIN_TEXT = '# Plain\n\nNothing special about this one.\n';
const META_TEXT = '---\ntitle: Notes\n---\n# Notes\n\nA document with metadata.\n';
const IMAGE_TEXT = '# Pictures\n\n![a diagram](assets/diagram.png)\n';
const BOTH_TEXT = '---\ntitle: Both\n---\n# Both\n\n![a diagram](assets/diagram.png)\n';

let disk: Map<string, string>;
let writes: string[];

const io: PlatformIO = {
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
    writes.push(`${path} :: ${content}`);
    disk.set(path, content);
  },
  readSnapshot: async (path: string): Promise<FileSnapshot> => {
    const text = disk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => null,
  installCloseGuard: async () => {},
  // No image is ever resolved to a blob here: `prepareMarkdownForDisplay`
  // tolerates a missing file and leaves the reference exactly as written,
  // which is the state a document with a broken reference is in anyway.
  readBinary: async () => {
    throw new Error('no such image');
  },
  writeBinary: async () => {},
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  remove: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const reporter: ErrorReporter = { silent: () => {}, toast: () => {}, dialog: async () => {} };

interface Rig {
  state: AppState;
  actions: DocumentActions;
  instance: EditorInstance;
  metadata: HTMLElement;
  images: HTMLElement;
  textarea: HTMLTextAreaElement;
}

/** The shipped indicator row and the shipped metadata panel. */
function mountShippedChrome(): void {
  const slice = (openTag: string, closeTag: string): string => {
    const start = shippedPage.indexOf(openTag);
    const end = shippedPage.indexOf(closeTag, start);
    if (start === -1 || end === -1) throw new Error(`index.html no longer has ${openTag}`);
    return shippedPage.slice(start, end + closeTag.length);
  };
  document.body.innerHTML =
    slice('<div id="header-indicators">', '</div>') +
    slice('<details id="frontmatter-panel"', '</details>');
}

function rig(): Rig {
  mountShippedChrome();
  const state = new AppState();

  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);

  const panel = setupFrontmatterPanel(state);
  const badges = setupDocumentBadges(instance.editor, { onImagesToggle: () => {} });

  // The two subscriptions `main.ts` installs, and nothing else.
  instance.editor.on('transaction', ({ transaction }) => {
    if (!transaction.docChanged) return;
    badges.refreshImages();
  });
  state.onFrontmatterChange((frontmatter) => badges.refreshMetadata(frontmatter));
  badges.refreshMetadata(state.frontmatter);
  badges.refreshImages();

  const ctx = {
    state,
    reporter,
    editor: instance.editor,
    getMarkdown: instance.getMarkdown,
    setMarkdown: instance.setMarkdown,
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: {
      refresh: panel.refresh,
      setVisible: () => panel.setVisible(shouldShowFrontmatterPanel(state)),
    },
  } as unknown as AppContext;

  return {
    state,
    actions: createDocumentActions(ctx),
    instance,
    metadata: document.getElementById('badge-metadata') as HTMLElement,
    images: document.getElementById('badge-images') as HTMLElement,
    textarea: document.getElementById('frontmatter-input') as HTMLTextAreaElement,
  };
}

/** What a user sees: the badge's own text, or nothing at all. */
function shown(badge: HTMLElement): string {
  return badge.getAttribute('aria-hidden') === 'true' ? '' : (badge.textContent ?? '');
}

function badgesShown(r: Rig): string[] {
  return [shown(r.metadata), shown(r.images)].filter((label) => label !== '');
}

beforeEach(() => {
  disk = new Map([
    [PLAIN, PLAIN_TEXT],
    [WITH_META, META_TEXT],
    [WITH_IMAGE, IMAGE_TEXT],
    [WITH_BOTH, BOTH_TEXT],
  ]);
  writes = [];
  clearImages();
});

describe('opening a document (R-C12)', () => {
  it('shows «Metadata» for a document that carries a metadata block', async () => {
    const r = rig();
    await r.actions.openFilePath(WITH_META);
    expect(badgesShown(r)).toEqual(['Metadata']);
  });

  it('shows «Images» for a document that references an image', async () => {
    const r = rig();
    await r.actions.openFilePath(WITH_IMAGE);
    expect(badgesShown(r)).toEqual(['Images']);
  });

  it('shows both, in that order, for a document that carries both', async () => {
    const r = rig();
    await r.actions.openFilePath(WITH_BOTH);
    expect(badgesShown(r)).toEqual(['Metadata', 'Images']);
  });

  it('shows neither for a plain document, and leaves nothing in the row', async () => {
    const r = rig();
    await r.actions.openFilePath(PLAIN);
    expect(badgesShown(r)).toEqual([]);
    // Not merely hidden: the label and the tooltip are what the overflow
    // menu copies, so a plain document must leave neither behind (#130).
    for (const badge of [r.metadata, r.images]) {
      expect(badge.textContent).toBe('');
      expect(badge.title).toBe('');
    }
  });

  it('takes the previous document’s badges down when the next one warrants none', async () => {
    const r = rig();
    await r.actions.openFilePath(WITH_BOTH);
    expect(badgesShown(r)).toEqual(['Metadata', 'Images']);

    await r.actions.openFilePath(PLAIN);
    expect(badgesShown(r)).toEqual([]);
  });

  it('brings them back when a document that warrants them is opened again', async () => {
    const r = rig();
    await r.actions.openFilePath(PLAIN);
    await r.actions.openFilePath(WITH_BOTH);
    expect(badgesShown(r)).toEqual(['Metadata', 'Images']);
  });
});

describe('emptying the metadata in the panel', () => {
  it('takes «Metadata» down, driven through the textarea’s own input event', async () => {
    const r = rig();
    await r.actions.openFilePath(WITH_META);
    expect(badgesShown(r)).toEqual(['Metadata']);
    expect(r.textarea.value).toBe('title: Notes');

    // The user's own gesture: select all, delete, which the browser
    // reports as one `input` event on the textarea. Nothing here writes
    // `state.frontmatter` — the panel's handler does, and that is the
    // route this test exists to cover. It is the one route the badge
    // could most easily have missed, because nothing else in the app
    // tells anybody the block is gone.
    r.textarea.value = '';
    r.textarea.dispatchEvent(new Event('input'));

    expect(r.state.frontmatter).toBe(null);
    expect(badgesShown(r)).toEqual([]);
    expect(r.metadata.title).toBe('');
  });

  it('brings it back when the user types a block into the panel again', async () => {
    const r = rig();
    await r.actions.openFilePath(WITH_META);
    r.textarea.value = '';
    r.textarea.dispatchEvent(new Event('input'));
    expect(badgesShown(r)).toEqual([]);

    r.textarea.value = 'title: Notes again';
    r.textarea.dispatchEvent(new Event('input'));
    expect(badgesShown(r)).toEqual(['Metadata']);
  });
});

describe('typing in the document', () => {
  it('lights «Images» when an image is inserted and drops it when it is removed', async () => {
    const r = rig();
    await r.actions.openFilePath(PLAIN);
    expect(badgesShown(r)).toEqual([]);

    r.instance.editor.commands.insertContent({
      type: 'image',
      attrs: { src: 'assets/new.png', alt: 'new' },
    });
    expect(badgesShown(r)).toEqual(['Images']);

    r.instance.editor.commands.undo();
    expect(badgesShown(r)).toEqual([]);
  });
});

describe('nothing about a badge reaches the file (R-C2)', () => {
  it('saves a document with both badges up byte for byte', async () => {
    const r = rig();
    await r.actions.openFilePath(WITH_BOTH);
    expect(badgesShown(r)).toEqual(['Metadata', 'Images']);

    await r.actions.handleSave();

    // Asserted on what the serializer handed the disk, not on editor
    // state: the badges are chrome in the header, outside the editor's
    // DOM entirely, so there is no path by which they could reach the
    // document — and this is the assertion that says so.
    expect(writes).toEqual([`${WITH_BOTH} :: ${BOTH_TEXT}`]);
    expect(disk.get(WITH_BOTH)).toBe(BOTH_TEXT);
  });

  it('saves a plain document byte for byte with both badges withdrawn', async () => {
    const r = rig();
    await r.actions.openFilePath(PLAIN);
    await r.actions.handleSave();

    expect(writes).toEqual([`${PLAIN} :: ${PLAIN_TEXT}`]);
  });

  it('never writes the badge labels into the markdown', async () => {
    const r = rig();
    await r.actions.openFilePath(WITH_BOTH);
    const markdown = r.instance.getMarkdown();
    expect(markdown).not.toContain('Metadata');
    expect(markdown).not.toContain('Images');
  });
});
