/**
 * #729 - the «Links» badge, its list and the jump, over a real editor, the
 * badges and the list mounted from the shipped page, and the document actions
 * with a disk held in a map, the harness of `relative-link-flow.test.ts`. The
 * check runs where the application runs it: at a document arriving and at a
 * save that wrote.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { EntryPresence, FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { shippedElement } from '../test-support/shipped-markup';
import { linksBadgeLabel, linksBadgeTooltip, setupDocumentBadges } from '../ui/document-badges';
import {
  brokenLinkLine,
  LINKS_NOT_CHECKED_HEADING,
  LINKS_POPOVER_HEADING,
  type LinksPopover,
  NOT_CHECKED_LINES,
  setupLinksPopover,
} from '../ui/links-popover';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { isOfferedInOverflow, overflowClone } from './header-wiring';
import {
  checkOnArrival,
  createLinksReport,
  LINK_GONE_MESSAGE,
  type LinksReport,
} from './links-report';
import { AppState } from './state';

const A = '/notes/docs/a.md';
const B = '/notes/docs/b.md';
const PLAIN = '/notes/docs/plain.md';

const toasts = vi.hoisted(() => [] as string[]);
vi.mock('../ui/toast', () => ({ showToast: vi.fn((m: string) => toasts.push(m)) }));

let disk: Map<string, string>;
let folders: Set<string>;
let presenceGate: Promise<void> | null;

const io = {
  pathsOutliveSession: true,
  canWriteCompanions: async () => true,
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
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  entryPresence: vi.fn(async (path: string): Promise<EntryPresence> => {
    if (presenceGate && path === '/notes/docs/gone.md') await presenceGate;
    return disk.has(path) || folders.has(path) ? 'present' : 'absent';
  }),
  listDir: vi.fn(
    async (path: string): Promise<FileEntry[]> =>
      [...disk.keys(), ...folders]
        .filter((p) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'))
        .map((p) => ({ name: p.slice(path.length + 1), path: p, isDirectory: folders.has(p) })),
  ),
  mkdir: async () => {},
  openWithSystem: vi.fn(async () => {}),
} as unknown as PlatformIO;

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));

const reporter: ErrorReporter = { silent: () => {}, toast: () => {}, dialog: async () => {} };

let state: AppState;
let instance: EditorInstance;
let host: HTMLElement;
let actions: DocumentActions;
let popover: LinksPopover;
let report: LinksReport;
let runs: Array<Promise<void>>;

beforeEach(async () => {
  localStorage.clear();
  toasts.length = 0;
  presenceGate = null;
  disk = new Map([
    [
      A,
      '# Alpha\n\n[good](b.md) and [gone](gone.md) and [also gone](../old/c.md)\n\n[heading](#h) [rooted](/r.md) [web](https://example.com/x.md)\n',
    ],
    [B, '# Beta\n'],
    [PLAIN, '# Plain\n\n[good](b.md) and [web](https://example.com)\n'],
  ]);
  folders = new Set(['/notes', '/notes/docs']);
  clearImages();
  document.body.innerHTML = `${shippedElement(shippedPage, '<div id="header-indicators">')}${shippedElement(shippedPage, '<aside id="links-popover"')}`;
  state = new AppState();
  host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host, () => state.setModified(true));
  popover = setupLinksPopover({ onJump: (link) => report.jump(link) });
  const badges = setupDocumentBadges(instance.editor, {
    onImagesToggle: () => {},
    onLinksToggle: () => popover.toggle(),
  });
  report = createLinksReport({
    editor: instance.editor,
    documentPath: () => state.filePath,
    io: async () => io,
    refreshBadge: (n) => badges.refreshLinks(n),
    popover,
  });
  runs = [];
  const run = () => {
    runs.push(report.run());
  };
  // The application puts the check after the next frame; here it runs at once.
  checkOnArrival(instance.editor, run, (fn) => fn());
  actions = createDocumentActions({
    state,
    reporter,
    editor: instance.editor,
    getMarkdown: instance.getMarkdown,
    setMarkdown: instance.setMarkdown,
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    checkLinks: run,
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext);
  vi.mocked(io.entryPresence).mockClear();
});

afterEach(() => {
  instance.destroy();
  document.body.innerHTML = '';
});

async function settled(): Promise<void> {
  await Promise.all(runs);
}

async function open(path: string): Promise<void> {
  await actions.openFilePath(path);
  await settled();
}

const badge = () => document.getElementById('badge-links') as HTMLElement;
const list = () => document.getElementById('links-popover') as HTMLElement;
const rows = () =>
  [...list().querySelectorAll('.links-row')].map((r) => [
    r.querySelector('.links-row-address')?.textContent,
    r.querySelector('.links-row-line')?.textContent,
  ]);

function typeAtStart(text: string): void {
  instance.editor.view.dispatch(instance.editor.state.tr.insertText(text, 1));
}

describe('the badge, only when a link is broken (#729)', () => {
  it('a document whose links are all good shows no badge, withdrawn as the other two', async () => {
    await open(PLAIN);
    expect(badge().style.display).toBe('none');
    expect(badge().getAttribute('aria-hidden')).toBe('true');
    expect(badge().textContent).toBe('');
    expect(isOfferedInOverflow(badge())).toBe(false);
  });

  it('a document with broken links shows the badge with their number', async () => {
    await open(A);
    expect(badge().style.display).toBe('');
    expect(badge().hasAttribute('aria-hidden')).toBe(false);
    expect(badge().textContent).toBe(linksBadgeLabel(2));
    // The form of the Images tooltip: one clause, a dash, no full stop.
    expect(badge().title).toBe(
      '2 links in this document point to files that are not there — click for the list',
    );
    expect(linksBadgeTooltip(1)).toBe(
      '1 link in this document points to a file that is not there — click for the list',
    );
  });

  it('opening a document with none broken after one with some withdraws it', async () => {
    await open(A);
    await open(PLAIN);
    expect(badge().style.display).toBe('none');
  });
});

describe('the list (#729)', () => {
  it('names the broken links first, then the links not checked with their reason', async () => {
    await open(A);
    badge().click();
    expect(list().classList.contains('hidden')).toBe(false);
    expect(badge().getAttribute('aria-expanded')).toBe('true');
    expect(list().querySelector('.header-popover-heading')?.textContent).toBe(
      LINKS_POPOVER_HEADING,
    );
    expect(list().querySelector('.links-apart-heading')?.textContent).toBe(
      LINKS_NOT_CHECKED_HEADING,
    );
    expect(rows()).toEqual([
      ['gone.md', brokenLinkLine('/notes/docs/gone.md')],
      ['../old/c.md', brokenLinkLine('/notes/old/c.md')],
      ['#h', NOT_CHECKED_LINES['anchor-only']],
      ['/r.md', NOT_CHECKED_LINES.rooted],
    ]);
  });

  it('opens from the copy the overflow menu holds below 600 px, as from the bar', async () => {
    await open(A);
    Object.defineProperty(badge(), 'offsetParent', { value: null, configurable: true });
    expect(isOfferedInOverflow(badge())).toBe(true);
    const copy = overflowClone(badge());
    expect(copy.textContent).toBe(linksBadgeLabel(2));
    copy.click();
    expect(list().classList.contains('hidden')).toBe(false);
    expect(rows()).toHaveLength(4);
  });

  it('a click on the badge again closes it', async () => {
    await open(A);
    badge().click();
    badge().click();
    expect(list().classList.contains('hidden')).toBe(true);
    expect(badge().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the jump to the link (#729)', () => {
  function selectedText(): string {
    const { from, to } = instance.editor.state.selection;
    return instance.editor.state.doc.textBetween(from, to);
  }

  it('a click on a row selects that link in the document and closes the list', async () => {
    await open(A);
    badge().click();
    (list().querySelectorAll('.links-row')[1] as HTMLElement).click();
    expect(selectedText()).toBe('also gone');
    expect(list().classList.contains('hidden')).toBe(true);
  });

  it('finds the link again after an edit before it', async () => {
    await open(A);
    typeAtStart('More words. ');
    badge().click();
    (list().querySelectorAll('.links-row')[0] as HTMLElement).click();
    expect(selectedText()).toBe('gone');
  });

  it('tells the person when a row names a link no longer there', () => {
    report.jump({ href: 'nowhere.md', from: 1, to: 2, text: 'x', occurrence: 0 });
    expect(toasts).toEqual([LINK_GONE_MESSAGE]);
  });
});

describe('when the check runs (#729)', () => {
  it('at a document arriving, and not at an edit', async () => {
    await open(A);
    const asked = vi.mocked(io.entryPresence).mock.calls.length;
    expect(asked).toBeGreaterThan(0);
    typeAtStart('x');
    typeAtStart('y');
    await settled();
    expect(vi.mocked(io.entryPresence).mock.calls.length).toBe(asked);
  });

  it('at a save that wrote: a link mended by an edit leaves the badge at the save', async () => {
    await open(A);
    // The targets arrive on the disk after the check: the badge keeps what the
    // check found through the edits, and the save checks again.
    disk.set('/notes/docs/gone.md', '# Gone\n');
    folders.add('/notes/old');
    disk.set('/notes/old/c.md', '# C\n');
    expect(badge().textContent).toBe(linksBadgeLabel(2));
    typeAtStart('x');
    await settled();
    expect(badge().textContent).toBe(linksBadgeLabel(2));
    await actions.handleSave();
    await settled();
    expect(badge().style.display).toBe('none');
  });

  it('the latest check wins over one still asking', async () => {
    let release: () => void = () => {};
    presenceGate = new Promise((r) => {
      release = r;
    });
    // The check of A waits on the disk while PLAIN is opened and checked.
    await actions.openFilePath(A);
    await actions.openFilePath(PLAIN);
    await runs[1];
    release();
    await settled();
    expect(badge().style.display).toBe('none');
  });

  it('never writes', async () => {
    await open(A);
    const before = new Map(disk);
    badge().click();
    (list().querySelectorAll('.links-row')[0] as HTMLElement).click();
    expect(disk).toEqual(before);
  });
});
