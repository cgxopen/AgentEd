import { describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { FrontmatterPanel } from '../ui/frontmatter-panel';
import type { AppContext } from './context';
import { createDocumentActions, type DocumentActions } from './document-actions';
import type { ErrorReporter } from './error-reporter';
import { AppState } from './state';

/**
 * Issue #403 — Blank Document and File then New agree, and a seed with content
 * still marks the document.
 *
 * The two routes were driven against each other on the step zero: they agreed
 * on the document, the path, the metadata, the first-save flag and the panel,
 * and differed on **one** state, the modified flag. Blank Document marked an
 * empty document, so closing the window raised the unsaved-changes gate over a
 * document nobody had typed in. The owner decided the flag follows whether the
 * seed has content; these rows hold both halves of that.
 */

const disk = new Map<string, string>();
const io: PlatformIO = {
  canWriteCompanions: async () => true,
  openFile: async () => null,
  pickFile: async () => null,
  readText: async (p: string) => disk.get(p) ?? '',
  saveFile: async (p: string, c: string) => {
    disk.set(p, c);
  },
  readSnapshot: async (): Promise<FileSnapshot> => ({ kind: 'absent' }),
  pickSavePath: async () => null,
  installCloseGuard: async () => {},
  readBinary: async () => new Uint8Array(),
  writeBinary: async () => {},
  entryPresence: async () => 'absent' as const,
  listDir: async (): Promise<FileEntry[]> => [],
  mkdir: async () => {},
  openWithSystem: async () => {},
};
vi.mock('../platform/index', () => ({ getPlatformIO: vi.fn(async () => io) }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const reporter = { dialog: async () => {}, toast: () => {} } as unknown as ErrorReporter;
let editor: EditorInstance;
let panelVisible = false;

function makeActions(state: AppState): DocumentActions {
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor = createEditor(host);
  const panel = {
    refresh: () => {},
    reveal: () => {},
    setVisible: (v: boolean) => {
      panelVisible = v;
    },
  } as unknown as FrontmatterPanel;
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
    frontmatterPanel: panel,
  } as unknown as AppContext;
  return createDocumentActions(ctx);
}

/** Everything the two routes were compared on, so a later difference is seen. */
function snapshot(state: AppState): Record<string, unknown> {
  return {
    markdown: editor.getMarkdown(),
    filePath: state.filePath,
    frontmatter: state.frontmatter,
    modified: state.modified,
    panelVisible,
  };
}

describe('Blank Document against File then New (#403)', () => {
  it('produces the same document and the same state, the flag included', async () => {
    panelVisible = false;
    const viaNew = new AppState();
    await makeActions(viaNew).handleNew();
    const fromNew = snapshot(viaNew);

    panelVisible = false;
    const viaTemplate = new AppState();
    await makeActions(viaTemplate).handleNewFromTemplate('blank');
    const fromTemplate = snapshot(viaTemplate);

    expect(fromTemplate).toEqual(fromNew);
    // Named rather than left to the deep compare, because this is the one that
    // moved: an empty document must not raise the unsaved-changes gate.
    expect(fromTemplate.modified).toBe(false);
    expect(fromTemplate.markdown).toBe('');
  });

  it('a seed with content still marks the document', async () => {
    // The other half. Without it the row above would pass for a build that
    // never marks anything, and a seeded document would close without a word.
    const state = new AppState();
    await makeActions(state).handleNewFromTemplate('blank-frontmatter');
    expect(state.modified).toBe(true);
    expect(editor.getMarkdown()).toContain('# Untitled');
    expect(state.frontmatter).toContain('title: Untitled');
  });
});
