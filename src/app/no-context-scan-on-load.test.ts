/**
 * #401 — opening a document probes nothing beside it.
 *
 * **The scan left, not only the display.** Until #401 every document load
 * ended with `scheduleClusterDetection`, which walked up to five levels of
 * the user's folder tree and probed six filenames in each directory, on
 * every open, whether or not anything was ever shown. This file is the
 * witness that the walk is gone rather than merely silent.
 *
 * ── Why the context files are present on the fake disk ──
 *
 * **A test that asserts an absence passes just as well when nothing was
 * ever there.** Driven against an empty folder, the rows below would be
 * green on a build whose scan still ran and simply found nothing. So the
 * disk holds `CLAUDE.md` and `AGENTS.md` in the document's own folder and
 * one more a level above it, which is the arrangement the old scan was
 * loudest on: it would have found three entries and probed at least
 * eighteen paths before it did.
 *
 * ── What counts as a probe ──
 *
 * Every path-taking method of `PlatformIO` records its argument, not only
 * the one the detector happened to use. `probeOne` asked `entryPresence`
 * and the preview asked `readText`, but a reinstated scan written any
 * other way — `listDir` over the folder, `readSnapshot` per candidate —
 * would be caught by the same recording. The assertion is about the six
 * names, not about one method.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImages } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

/**
 * The six filenames the registry deleted on #401 listed, spelled here
 * rather than imported because the module that held them has gone. If a
 * scan ever comes back, it comes back looking for these.
 */
const CONTEXT_NAMES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.hermes.md',
  'HERMES.md',
  '.cursorrules',
  'SOUL.md',
];

const DOC = '/repo/docs/note.md';
const DOC_TEXT = '# Note\n\nAn ordinary document with context files all around it.\n';

/** The arrangement the old scan found three entries in. */
const DISK: ReadonlyArray<readonly [string, string]> = [
  [DOC, DOC_TEXT],
  ['/repo/docs/CLAUDE.md', '# Instructions for this folder\n'],
  ['/repo/docs/AGENTS.md', '# Agents\n'],
  ['/repo/CLAUDE.md', '# Instructions for the repository\n'],
];

let disk: Map<string, string>;
/** Every path any read-ish platform call was given, in order. */
let asked: string[];

const io: PlatformIO = {
  supportsMultiFile: true,
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async (path: string) => {
    asked.push(path);
    const text = disk.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  saveFile: async () => {},
  readSnapshot: async (path: string): Promise<FileSnapshot> => {
    asked.push(path);
    const text = disk.get(path);
    return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
  },
  pickSavePath: async () => null,
  installCloseGuard: async () => {},
  readBinary: async () => {
    throw new Error('no such image');
  },
  writeBinary: async () => {},
  entryPresence: async (path: string) => {
    asked.push(path);
    return 'absent' as const;
  },
  listDir: async (path: string): Promise<FileEntry[]> => {
    asked.push(path);
    return [];
  },
  mkdir: async () => {},
  openWithSystem: async () => {},
};

vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const reporter: ErrorReporter = { silent: () => {}, toast: () => {}, dialog: async () => {} };

let instance: EditorInstance;
let host: HTMLElement;
let actions: DocumentActions;

beforeEach(() => {
  disk = new Map(DISK.map(([p, t]) => [p, t]));
  asked = [];
  clearImages();

  host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host, () => {});

  actions = createDocumentActions({
    state: new AppState(),
    reporter,
    editor: instance.editor,
    getMarkdown: instance.getMarkdown,
    setMarkdown: instance.setMarkdown,
    refreshSidebar: async () => {},
    setFilename: () => {},
    updateCloseEnabled: () => {},
    sidebar: { hide: () => {} },
    statusbar: { refresh: () => {} },
    frontmatterPanel: { refresh: () => {}, setVisible: () => {} },
  } as unknown as AppContext);
});

/** The basename of a forward-slash path. */
function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

describe('opening a document with context files beside it (#401)', () => {
  it('asks for none of the six context-file names', async () => {
    await actions.openFilePath(DOC);

    const probed = asked.filter((path) => CONTEXT_NAMES.includes(basename(path)));
    expect(probed).toEqual([]);
  });

  it('asks for nothing outside the document own folder', async () => {
    await actions.openFilePath(DOC);

    // The walk up was the expensive half: five levels, fifty children each.
    // Nothing may reach above `/repo/docs` now.
    const above = asked.filter((path) => !path.startsWith('/repo/docs'));
    expect(above).toEqual([]);
  });

  it('still reads the document itself, so the rows above are not green by accident', () => {
    // The guard the two absences need: a load that read nothing at all
    // would satisfy both of them and would also be a broken editor.
    return actions.openFilePath(DOC).then(() => {
      expect(asked).toContain(DOC);
      expect(instance.getMarkdown()).toContain('An ordinary document');
    });
  });
});
