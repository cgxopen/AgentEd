/**
 * #717 and #721 — what the files panel draws of a folder: system files and dot
 * files left out without a word, dot folders drawn hidden and counted, with a
 * line under the tree that shows them on request.
 *
 * Driven through the real `setupSidebar` and the real `refreshSidebar`, over a
 * disk in memory whose `listDir` is counted, so the rows hold what the person
 * sees and also what the disk was asked. Hidden is the `hidden` property of the
 * row, which happy-dom keeps; whether the line sits where it reads well under
 * the tree is the owner pass on the artifact.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, PlatformIO } from '../platform/types';
import { entryVisibility } from '../ui/entry-visibility';
import {
  buildTree,
  HIDDEN_LINE_CLASS,
  HIDE_HIDDEN,
  hiddenCountText,
  SHOW_HIDDEN,
  type Sidebar,
  setupSidebar,
} from '../ui/sidebar';
import { countHidden, HIDDEN_ENTRY_CLASS } from '../ui/sidebar-tree';
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

/** The system names of the issue, as a folder holds them. */
const SYSTEM_FILES = ['.DS_Store', 'Thumbs.db', 'ehthumbs.db', 'desktop.ini'];
const SYSTEM_FOLDERS = [
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.git',
];

/** The owner pass of the brief: the image used, the system files, a dot file, `.git` and `.github`. */
const OWNER_PASS: Disk = {
  '/proj/assets': [
    'photo.png',
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '._photo.png',
    '.gitkeep',
    '.git/',
    '.github/',
  ],
  '/proj/assets/.git': ['HEAD', 'config'],
  '/proj/assets/.github': ['ci.yml', 'README.md'],
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
const nameOf = (row: Element) => (row.textContent ?? '').replace(/^\S+\s/, '');

/** Every row drawn, hidden or not, in page order: what was left out is in none. */
function drawn(): string[] {
  return [...tree().querySelectorAll('.sidebar-file-entry, .sidebar-folder-toggle')].map(nameOf);
}

/**
 * The rows not hidden by Show and Hide, in page order, a folder followed by
 * what it holds. A folded folder still holds its rows: folding is the person
 * closing a folder, not this rule hiding it.
 */
function seen(): string[] {
  return [...tree().querySelectorAll<HTMLElement>('.sidebar-file-entry, .sidebar-folder-toggle')]
    .filter((row) => !row.closest('li[hidden]'))
    .map(nameOf);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('what a name is (#721)', () => {
  it.each([...SYSTEM_FILES, ...SYSTEM_FOLDERS])('%s is left out, in either letter case', (name) => {
    for (const spelled of [name, name.toUpperCase(), name.toLowerCase()]) {
      expect(entryVisibility(spelled, false)).toBe('left-out');
      expect(entryVisibility(spelled, true)).toBe('left-out');
    }
  });

  it('a name starting with ._ is left out, file or folder', () => {
    expect(entryVisibility('._photo.png', false)).toBe('left-out');
    expect(entryVisibility('._PHOTO.PNG', false)).toBe('left-out');
    expect(entryVisibility('._folder', true)).toBe('left-out');
  });

  it('any other dot file is left out, and a dot folder is counted', () => {
    for (const name of ['.gitkeep', '.gitignore', '.hidden.txt', '.cursorrules']) {
      expect(entryVisibility(name, false)).toBe('left-out');
    }
    for (const name of ['.github', '.cache', '.cursor', '.vscode']) {
      expect(entryVisibility(name, true)).toBe('counted');
    }
  });

  it('everything else is shown', () => {
    for (const [name, isDirectory] of [
      ['photo.png', false],
      ['notes.md', false],
      ['Thumbs.db.bak', false],
      ['images', true],
      ['x.', false],
    ] as const) {
      expect(entryVisibility(name, isDirectory)).toBe('shown');
    }
  });

  it('counts a dot folder as one, whatever it holds, and nothing left out', () => {
    const nodes = buildTree([
      { path: 'photo.png', kind: 'file' },
      { path: '.DS_Store', kind: 'file' },
      { path: '.gitkeep', kind: 'file' },
      { path: '.git', kind: 'directory' },
      { path: '.git/.inner', kind: 'directory' },
      { path: '.cache', kind: 'directory' },
      { path: '.cache/.nested', kind: 'directory' },
      { path: 'deep', kind: 'directory' },
      { path: 'deep/.thumbs', kind: 'directory' },
      { path: 'deep/.DS_Store', kind: 'file' },
    ]);
    expect(countHidden(nodes)).toBe(2);
  });
});

describe('the panel leaves system files and dot files out, and counts dot folders (#721)', () => {
  it('the owner pass: only the image, and 1 hidden folder · Show', async () => {
    await open(OWNER_PASS);
    expect(seen()).toEqual(['photo.png']);
    expect(drawn()).toEqual(['.github', 'ci.yml', 'README.md', 'photo.png']);
    expect(tree().querySelectorAll(`li.${HIDDEN_ENTRY_CLASS}`)).toHaveLength(1);
    expect(line()?.textContent).toBe('1 hidden folder · Show');
  });

  it('says 2 hidden folders for two', async () => {
    await open({
      '/proj/assets': ['photo.png', '.github/', '.cache/'],
      '/proj/assets/.github': ['ci.yml'],
      '/proj/assets/.cache': ['one.bin'],
    });
    expect(line()?.textContent).toBe(`${hiddenCountText(2)} · ${SHOW_HIDDEN}`);
    expect(line()?.textContent).toBe('2 hidden folders · Show');
  });

  it('draws no line when only left-out names are there', async () => {
    await open({
      '/proj/assets': ['photo.png', ...SYSTEM_FILES, '._photo.png', '.gitkeep', '.git/'],
      '/proj/assets/.git': ['HEAD'],
    });
    expect(line()).toBeNull();
    expect(drawn()).toEqual(['photo.png']);
  });

  it('leaves every system name out at the root, in any letter case, folders with what they hold', async () => {
    const names = [
      ...SYSTEM_FILES.map((n) => n.toUpperCase()),
      ...SYSTEM_FOLDERS.map((n) => `${n.toLowerCase()}/`),
    ];
    const disk: Disk = { '/proj/assets': ['photo.png', ...names] };
    for (const folder of SYSTEM_FOLDERS)
      disk[`/proj/assets/${folder.toLowerCase()}`] = ['inside.txt'];
    await open(disk);
    expect(drawn()).toEqual(['photo.png']);
    expect(line()).toBeNull();
  });

  it('leaves .git out with what it holds, Show or not', async () => {
    await open(OWNER_PASS);
    lineButton().click();
    expect(drawn()).not.toContain('.git');
    expect(drawn()).not.toContain('HEAD');
    expect(drawn()).not.toContain('config');
  });

  it('leaves a dot file out deeper down, and counts a dot folder deeper down', async () => {
    await open({
      '/proj/assets': ['photo.png', 'icons/'],
      '/proj/assets/icons': ['star.svg', '.DS_Store', '.gitkeep', '.thumbs/'],
      '/proj/assets/icons/.thumbs': ['star.png'],
    });
    expect(seen()).toEqual(['icons', 'star.svg', 'photo.png']);
    expect(drawn()).toEqual(['icons', '.thumbs', 'star.png', 'star.svg', 'photo.png']);
    expect(line()?.textContent).toBe('1 hidden folder · Show');
  });

  it('leaves a dot file out inside a shown dot folder', async () => {
    await open({
      '/proj/assets': ['photo.png', '.github/'],
      '/proj/assets/.github': ['ci.yml', '.hidden.yml', '.DS_Store'],
    });
    lineButton().click();
    expect(seen()).toEqual(['.github', 'ci.yml', 'photo.png']);
  });

  it('puts the line after the tree, as the last thing in the panel', async () => {
    await open(OWNER_PASS);
    expect(tree().lastElementChild).toBe(line());
  });
});

describe('Show and Hide, as since #717', () => {
  it('Show reveals .github with its two files and nothing else; Hide puts it back', async () => {
    await open(OWNER_PASS);

    lineButton().click();
    expect(seen()).toEqual(['.github', 'ci.yml', 'README.md', 'photo.png']);
    expect(line()?.textContent).toBe(`1 hidden folder · ${HIDE_HIDDEN}`);

    lineButton().click();
    expect(seen()).toEqual(['photo.png']);
    expect(line()?.textContent).toBe('1 hidden folder · Show');
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

    expect(seen()).toEqual(['.github', 'ci.yml', 'README.md', 'photo.png']);
    expect(lineButton().textContent).toBe(HIDE_HIDDEN);
  });

  it('forgets the choice on a new root', async () => {
    const disk: Disk = {
      ...OWNER_PASS,
      '/other/assets': ['pic.png', '.cache/'],
      '/other/assets/.cache': ['one.bin'],
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

describe('the grey of #380 is untouched (#721)', () => {
  /** Unused: every file but the image the document references. */
  const unused = (path: string) => path !== '/proj/assets/photo.png';
  const greyed = () => [...tree().querySelectorAll('.sidebar-file-unused')].map(nameOf);

  it('the image used stays ungreyed, and the files of a shown dot folder are greyed', async () => {
    const { sidebar } = await open(OWNER_PASS);
    sidebar.markUnused(unused);

    const photo = tree().querySelector<HTMLElement>('[data-path="/proj/assets/photo.png"]');
    expect(photo?.classList.contains('sidebar-file-unused')).toBe(false);
    expect(greyed()).toEqual(['ci.yml', 'README.md']);

    lineButton().click();
    expect(photo?.classList.contains('sidebar-file-unused')).toBe(false);
    expect(greyed()).toEqual(['ci.yml', 'README.md']);
  });
});

describe('a file the document uses whose name starts with a dot (#721, stop 3, for the owner)', () => {
  it('is left out of the panel like any other dot file, today', async () => {
    // The document references `assets/.logo.png`. The rule is by name, so the
    // panel does not list it, though the document shows it. Pinned as the rule
    // stands, and reported on the pull request for the owner to decide.
    await open({ '/proj/assets': ['photo.png', '.logo.png'] });
    expect(drawn()).toEqual(['photo.png']);
    expect(line()).toBeNull();
  });
});
