/**
 * #717 — the files panel hides entries whose name starts with a dot, and a line
 * under the tree shows them on request.
 *
 * Driven through the real `setupSidebar` and the real `refreshSidebar`, over a
 * disk in memory whose `listDir` is counted, so the rows hold what the person
 * sees and also what the disk was asked. Hidden is the `hidden` property of the
 * row, which happy-dom keeps; whether the line sits where it reads well under
 * the tree is the owner pass on the artifact.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, PlatformIO } from '../platform/types';
import {
  buildTree,
  HIDDEN_LINE_CLASS,
  HIDE_HIDDEN,
  hiddenCountText,
  SHOW_HIDDEN,
  type Sidebar,
  setupSidebar,
} from '../ui/sidebar';
import { countHidden, HIDDEN_ENTRY_CLASS, isHiddenName } from '../ui/sidebar-tree';
import { refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

/** A disk of folders, each a list of names; a name ending in `/` is a folder. */
type Disk = Record<string, string[]>;

function io(disk: Disk): PlatformIO & { listDir: ReturnType<typeof vi.fn> } {
  const listDir = vi.fn(
    async (path: string): Promise<FileEntry[]> =>
      (disk[path] ?? []).map((name) => {
        const isDirectory = name.endsWith('/');
        const bare = isDirectory ? name.slice(0, -1) : name;
        return { name: bare, path: `${path}/${bare}`, isDirectory };
      }),
  );
  return {
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    readSnapshot: async () => ({ kind: 'absent' as const }),
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async (path: string) => (path in disk ? 'present' : 'absent'),
    listDir,
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

/** The owner pass of the brief: an image used, a dot file, and a dot folder of two files. */
const OWNER_PASS: Disk = {
  '/proj/assets': ['photo.png', '.hidden.txt', '.cache/'],
  '/proj/assets/.cache': ['one.bin', 'two.bin'],
};

function mountPanel(): Sidebar {
  document.body.innerHTML = '<div id="sidebar" class="hidden"><div id="sidebar-tree"></div></div>';
  return setupSidebar();
}

async function open(disk: Disk, filePath = '/proj/doc.md') {
  const sidebar = mountPanel();
  const state = new AppState();
  state.filePath = filePath;
  state.referencesImage = true;
  const fs = io(disk);
  await refreshSidebar(state, sidebar, fs);
  return { sidebar, state, fs };
}

const tree = () => document.getElementById('sidebar-tree') as HTMLElement;
const line = () => tree().querySelector<HTMLElement>(`.${HIDDEN_LINE_CLASS}`);
const lineButton = () => line()?.querySelector('button') as HTMLButtonElement;

/**
 * The names of the rows not hidden by the dot rule, in page order, a folder
 * followed by what it holds. A folded folder still holds its rows: folding is
 * the person closing a folder, not this rule hiding it.
 */
function seen(): string[] {
  return [...tree().querySelectorAll<HTMLElement>('.sidebar-file-entry, .sidebar-folder-toggle')]
    .filter((row) => !row.closest('li[hidden]'))
    .map((row) => (row.textContent ?? '').replace(/^\S+\s/, ''));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('which names are hidden (#717)', () => {
  it('a name that starts with a dot, and no other', () => {
    expect(['.DS_Store', '.hidden.txt', '.cache', '.git'].map(isHiddenName)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(['photo.png', 'a.b.png', 'notes.md', 'x.'].map(isHiddenName)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('counts a hidden folder as one, whatever it holds, and nothing inside it', () => {
    const nodes = buildTree([
      { path: 'photo.png', kind: 'file' },
      { path: '.hidden.txt', kind: 'file' },
      { path: '.cache', kind: 'directory' },
      { path: '.cache/one.bin', kind: 'file' },
      { path: '.cache/.inner', kind: 'file' },
      { path: 'deep', kind: 'directory' },
      { path: 'deep/.DS_Store', kind: 'file' },
      { path: 'deep/shown.png', kind: 'file' },
    ]);
    expect(countHidden(nodes)).toBe(3);
  });
});

describe('the panel hides dot entries and says how many (#717)', () => {
  it('hides a dot file and a dot folder at the root, and what the folder holds', async () => {
    await open(OWNER_PASS);
    expect(seen()).toEqual(['photo.png']);
    expect(tree().querySelectorAll(`li.${HIDDEN_ENTRY_CLASS}`)).toHaveLength(2);
  });

  it('hides a dot file and a dot folder deeper down too', async () => {
    await open({
      '/proj/assets': ['photo.png', 'icons/'],
      '/proj/assets/icons': ['star.svg', '.DS_Store', '.thumbs/'],
      '/proj/assets/icons/.thumbs': ['star.png'],
    });
    expect(seen()).toEqual(['icons', 'star.svg', 'photo.png']);
    expect(line()?.textContent).toBe(`${hiddenCountText(2)} · ${SHOW_HIDDEN}`);
  });

  it('says 2 hidden files when a dot file and a dot folder of two files are hidden', async () => {
    await open(OWNER_PASS);
    expect(line()?.textContent).toBe('2 hidden files · Show');
  });

  it('says 1 hidden file for one', async () => {
    await open({ '/proj/assets': ['photo.png', '.DS_Store'] });
    expect(line()?.textContent).toBe('1 hidden file · Show');
  });

  it('draws no line when nothing is hidden', async () => {
    await open({ '/proj/assets': ['photo.png', 'notes.md'] });
    expect(line()).toBeNull();
    expect(seen()).toEqual(['notes.md', 'photo.png']);
  });

  it('puts the line after the tree, as the last thing in the panel', async () => {
    await open(OWNER_PASS);
    expect(tree().lastElementChild).toBe(line());
  });
});

describe('Show and Hide (#717)', () => {
  it('Show reveals them in place and the line says Hide; Hide puts them back', async () => {
    await open(OWNER_PASS);

    lineButton().click();
    expect(seen()).toEqual(['.cache', 'one.bin', 'two.bin', '.hidden.txt', 'photo.png']);
    expect(line()?.textContent).toBe(`2 hidden files · ${HIDE_HIDDEN}`);

    lineButton().click();
    expect(seen()).toEqual(['photo.png']);
    expect(line()?.textContent).toBe('2 hidden files · Show');
  });

  it('reads nothing from the disk, and draws nothing again', async () => {
    const { fs } = await open(OWNER_PASS);
    const reads = fs.listDir.mock.calls.length;
    const firstRow = tree().querySelector('li');

    lineButton().click();
    lineButton().click();

    expect(fs.listDir.mock.calls.length).toBe(reads);
    expect(tree().querySelector('li')).toBe(firstRow);
  });

  it('keeps the choice when the same folder is drawn again, as after a save', async () => {
    const { sidebar, state, fs } = await open(OWNER_PASS);
    lineButton().click();

    await refreshSidebar(state, sidebar, fs, 'same-document');

    expect(seen()).toEqual(['.cache', 'one.bin', 'two.bin', '.hidden.txt', 'photo.png']);
    expect(lineButton().textContent).toBe(HIDE_HIDDEN);
  });

  it('forgets the choice on a new root', async () => {
    const disk: Disk = {
      ...OWNER_PASS,
      '/other/assets': ['pic.png', '.DS_Store'],
    };
    const { sidebar, state, fs } = await open(disk);
    lineButton().click();

    state.filePath = '/other/doc.md';
    await refreshSidebar(state, sidebar, fs);

    expect(seen()).toEqual(['pic.png']);
    expect(lineButton().textContent).toBe(SHOW_HIDDEN);
  });

  it('forgets the choice when the panel is hidden, and starts hidden again', async () => {
    const { sidebar, state, fs } = await open(OWNER_PASS);
    lineButton().click();

    sidebar.hide();
    await refreshSidebar(state, sidebar, fs);

    expect(seen()).toEqual(['photo.png']);
  });
});

describe('the grey of #380 is untouched by hiding (#717)', () => {
  /** Unused: every file but the image the document references. */
  const unused = (path: string) => path !== '/proj/assets/photo.png';
  const greyed = () =>
    [...tree().querySelectorAll<HTMLElement>('.sidebar-file-unused')].map((row) =>
      (row.textContent ?? '').replace(/^\S+\s/, ''),
    );

  it('marks the visible files as before, and the hidden ones like any other row', async () => {
    const { sidebar } = await open(OWNER_PASS);
    sidebar.markUnused(unused);

    const photo = tree().querySelector<HTMLElement>('[data-path="/proj/assets/photo.png"]');
    expect(photo?.classList.contains('sidebar-file-unused')).toBe(false);
    expect(greyed()).toEqual(['one.bin', 'two.bin', '.hidden.txt']);

    lineButton().click();
    expect(photo?.classList.contains('sidebar-file-unused')).toBe(false);
    expect(greyed()).toEqual(['one.bin', 'two.bin', '.hidden.txt']);
  });
});
