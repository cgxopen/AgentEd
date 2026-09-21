/**
 * #401 — nothing of the related indicator is drawn, on the one document
 * that used to draw it.
 *
 * ── Said first: one half of this is not observable here ──
 *
 * **Whether the overflow menu offers an entry cannot be driven in this
 * harness.** `isOfferedInOverflow` ends on `ind.offsetParent === null`,
 * `offsetParent` is layout, and happy-dom performs none — it answers
 * `undefined` for every element, so nothing is ever offered and a row that
 * opened the menu and found no entry would pass against a build that still
 * had one. `header-wiring.ts` says as much in its own comment.
 *
 * So the menu is asserted as its two halves, joined. The selector the menu
 * actually runs is **read out of `header-wiring.ts`** rather than restated
 * here, and run against the markup the page actually ships. Either half
 * alone asserts nothing: a selector nobody reaches and markup nobody
 * queries both pass a test that checks only one side. Together they say the
 * menu cannot offer what its own query cannot find.
 *
 * The seat of the row and how it looks at each width stay with the manual
 * pass on the pull request artifact, which is where this change is
 * verified rather than merely confirmed.
 *
 * ── Why the document has context files around it ──
 *
 * **A test that asserts an absence passes just as well when nothing was
 * ever rendered.** The rows below open `/repo/docs/note.md` with
 * `CLAUDE.md` and `AGENTS.md` beside it and one more above — the document
 * the indicator was loudest on, where it read 📎 *3 related*. An empty
 * folder would have made every row green on the old build too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { shippedElement } from '../test-support/shipped-markup';
import { setupDocumentBadges } from '../ui/document-badges';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import headerWiringSource from './header-wiring.ts?raw';
import { AppState } from './state';

const DOC = '/repo/docs/note.md';
const DOC_TEXT = '# Note\n\nAn ordinary document with context files all around it.\n';

const DISK: ReadonlyArray<readonly [string, string]> = [
  [DOC, DOC_TEXT],
  ['/repo/docs/CLAUDE.md', '# Instructions for this folder\n'],
  ['/repo/docs/AGENTS.md', '# Agents\n'],
  ['/repo/CLAUDE.md', '# Instructions for the repository\n'],
];

let disk: Map<string, string>;

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
  saveFile: async () => {},
  readSnapshot: async (path: string): Promise<FileSnapshot> => {
    const text = disk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => null,
  installCloseGuard: async () => {},
  readBinary: async () => {
    throw new Error('no such image');
  },
  writeBinary: async () => {},
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const reporter: ErrorReporter = { silent: () => {}, toast: () => {}, dialog: async () => {} };

let instance: EditorInstance;
let host: HTMLElement;
let actions: DocumentActions;

/**
 * The query `renderOverflowPopover` runs, taken from the module rather than
 * retyped. A rename there that this file did not follow fails here instead
 * of leaving a row that quietly stops reaching the menu.
 */
function overflowQuery(): string {
  const found = /querySelectorAll<HTMLElement>\(\s*'([^']+)'/.exec(headerWiringSource);
  if (!found) throw new Error('header-wiring.ts no longer collects the indicators by selector');
  return found[1];
}

/** The ids `#header-indicators` holds, in document order. */
function indicatorIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(overflowQuery())).map((el) => el.id);
}

beforeEach(() => {
  disk = new Map(DISK.map(([p, t]) => [p, t]));
  clearImages();

  document.body.innerHTML = shippedElement(shippedPage, '<div id="header-indicators">');

  host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host, () => {});

  const state = new AppState();
  const badges = setupDocumentBadges(instance.editor, { onImagesToggle: () => {} });
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
    statusbar: { refresh: () => badges.refreshImages() },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext;
  state.onFrontmatterChange((fm) => badges.refreshMetadata(fm));
  actions = createDocumentActions(ctx);
});

describe('the header after opening a document with context files around it (#401)', () => {
  it('holds no element of the related indicator', async () => {
    await actions.openFilePath(DOC);

    expect(document.getElementById('cluster-indicator')).toBeNull();
    expect(document.querySelector('.cluster-indicator')).toBeNull();
    expect(document.querySelector('[aria-controls="cluster-popover"]')).toBeNull();
  });

  it('has the same indicators after the load as before it', async () => {
    const before = indicatorIds();
    await actions.openFilePath(DOC);

    // Nothing in the build can add to this row on a load any more. The
    // indicator used to arrive here once the scan landed.
    expect(indicatorIds()).toEqual(before);
  });

  it('offers the overflow menu nothing of it, by the menu own query', async () => {
    await actions.openFilePath(DOC);

    // The joined halves: the selector comes from `header-wiring.ts`, the
    // elements from the shipped page. What the menu cannot find it cannot
    // clone.
    expect(overflowQuery()).toBe('#header-indicators .indicator');
    expect(indicatorIds()).toEqual([
      'token-number',
      'token-unit',
      'word-count',
      'char-count',
      'indicator-search',
      'badge-metadata',
      'badge-images',
    ]);
  });

  it('ships no popover for it either', () => {
    expect(shippedPage).not.toContain('id="cluster-popover"');
    expect(document.getElementById('cluster-popover')).toBeNull();
  });
});
