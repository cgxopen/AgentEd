/**
 * What the R-C12 «Images» popover can honestly say.
 *
 * R-C12's example — *"3 images used by this document · assets/ holds 9
 * more files"* — assumes the second number always exists. It does not,
 * and step zero of #196 is where that was measured: the folder may be
 * absent, the document may never have been saved, and on either platform
 * the answer may be *nothing could be established*. The requirement was
 * amended in the same pull request; these are the four states.
 *
 * The sentences are pinned on literal bytes, because a wording assertion
 * built from the function that produces the wording passes for any
 * wording at all (#173).
 */
import { describe, expect, it, vi } from 'vitest';
import { clearImages, registerImage } from '../editor/image-registry';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { EntryPresence, FileEntry, PlatformIO } from '../platform/types';
import { describeAssets, summariseAssets } from './assets-summary';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const DOC = '/project/notes.md';
const ASSETS = '/project/assets';

interface Folder {
  presence: EntryPresence;
  /** Names in `assets/`, or an error the listing raises instead. */
  entries?: string[];
  listThrows?: boolean;
  dirs?: string[];
}

function io(folder: Folder): PlatformIO {
  return {
    // Answering `false` here would make every state below `null`, which
    // is the whole reason this path does not ask (#201). Set to `false`
    // deliberately: if `summariseAssets` ever starts consulting it, every
    // test in this file turns red rather than quietly reporting nothing.
    canWriteCompanions: async () => false,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    readSnapshot: async () => ({ kind: 'absent' }) as const,
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async (path: string) => {
      expect(path).toBe(ASSETS);
      return folder.presence;
    },
    listDir: async (path: string): Promise<FileEntry[]> => {
      expect(path).toBe(ASSETS);
      if (folder.listThrows) throw new Error('EACCES: permission denied');
      const files = (folder.entries ?? []).map((name) => ({
        name,
        path: `${ASSETS}/${name}`,
        isDirectory: false,
      }));
      const dirs = (folder.dirs ?? []).map((name) => ({
        name,
        path: `${ASSETS}/${name}`,
        isDirectory: true,
      }));
      return [...files, ...dirs];
    },
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  instance?.destroy();
  clearImages();
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

describe('counting the images a document uses', () => {
  it('counts one per distinct image, not one per placement', async () => {
    const editor = editorWith(
      '# T\n\n![a](assets/one.png)\n\n![again](assets/one.png)\n\n![b](assets/two.png)\n',
    );
    const summary = await summariseAssets(editor.editor, DOC, io({ presence: 'absent' }));
    // The same picture placed twice is one image used twice — R-C12 asks
    // how many images the document *uses*.
    expect(summary.imagesInDocument).toBe(2);
  });

  it('counts an image the loader could not resolve', async () => {
    const editor = editorWith('# T\n\n![a](assets/missing.png)\n');
    const summary = await summariseAssets(editor.editor, DOC, io({ presence: 'absent' }));
    expect(summary.imagesInDocument).toBe(1);
  });

  it('counts a resolved image by the path it has on disk', async () => {
    // What a document looks like once it is on screen: the loader has
    // rewritten the reference to a blob URL and registered the mapping.
    const editor = editorWith('# T\n\n![a](blob:fake-url)\n');
    registerImage('blob:fake-url', {
      relativePath: 'assets/real.png',
      data: new Uint8Array(),
      filename: 'real.png',
    });

    const summary = await summariseAssets(
      editor.editor,
      DOC,
      io({ presence: 'present', entries: ['real.png', 'other.png'] }),
    );
    expect(summary.imagesInDocument).toBe(1);
    // `real.png` is this document's, so only `other.png` is another file.
    expect(summary.folder).toEqual({ kind: 'counted', otherFiles: 1 });
  });

  it('counts nothing for a document with no images', async () => {
    const editor = editorWith('# T\n\nJust words.\n');
    const summary = await summariseAssets(editor.editor, DOC, io({ presence: 'absent' }));
    expect(summary.imagesInDocument).toBe(0);
  });
});

describe('what could be established about the folder', () => {
  it('counts the other files when the folder can be listed', async () => {
    const editor = editorWith('# T\n\n![a](assets/one.png)\n');
    const summary = await summariseAssets(
      editor.editor,
      DOC,
      io({ presence: 'present', entries: ['one.png', 'two.png', 'three.png'] }),
    );
    expect(summary.folder).toEqual({ kind: 'counted', otherFiles: 2 });
  });

  it('does not count subfolders as files', async () => {
    const editor = editorWith('# T\n\n![a](assets/one.png)\n');
    const summary = await summariseAssets(
      editor.editor,
      DOC,
      io({ presence: 'present', entries: ['two.png'], dirs: ['thumbnails'] }),
    );
    // R-C12 says how many other *files* the folder holds.
    expect(summary.folder).toEqual({ kind: 'counted', otherFiles: 1 });
  });

  it('says the folder is absent rather than empty', async () => {
    const editor = editorWith('# T\n\n![a](assets/one.png)\n');
    const summary = await summariseAssets(editor.editor, DOC, io({ presence: 'absent' }));
    expect(summary.folder).toEqual({ kind: 'absent' });
  });

  it('says nothing could be established when presence is unknown', async () => {
    const editor = editorWith('# T\n\n![a](assets/one.png)\n');
    // A browser session with no grant answers `unknown` here, and its
    // `listDir` would answer `[]` — the confident wrong answer this
    // branch exists to avoid (#58, #184).
    const summary = await summariseAssets(editor.editor, DOC, io({ presence: 'unknown' }));
    expect(summary.folder).toEqual({ kind: 'unknown' });
  });

  it('says nothing could be established when the listing raises', async () => {
    const editor = editorWith('# T\n\n![a](assets/one.png)\n');
    // A folder that is there and shut: `TauriIO.listDir` raises rather
    // than answering. Never reported as zero (#58).
    const summary = await summariseAssets(
      editor.editor,
      DOC,
      io({ presence: 'present', listThrows: true }),
    );
    expect(summary.folder).toEqual({ kind: 'unknown' });
  });

  it('says the folder is still to come for a document never saved', async () => {
    const editor = editorWith('# T\n\n![a](blob:pasted)\n');
    // Nothing is looked at: there is no path to derive a folder from, and
    // R-C5 creates `assets/` at save time and not before (#14).
    const summary = await summariseAssets(
      editor.editor,
      null,
      io({ presence: 'present', entries: ['nobody.png'] }),
    );
    expect(summary.folder).toEqual({ kind: 'unsaved' });
  });
});

describe('the sentence the popover shows', () => {
  it('matches the wording R-C12 gives as its example', () => {
    expect(
      describeAssets({ imagesInDocument: 3, folder: { kind: 'counted', otherFiles: 9 } }),
    ).toBe('3 images used by this document · assets/ holds 9 more files');
  });

  it('says the singular for one image and one file', () => {
    expect(
      describeAssets({ imagesInDocument: 1, folder: { kind: 'counted', otherFiles: 1 } }),
    ).toBe('1 image used by this document · assets/ holds 1 more file');
  });

  it('says the folder holds nothing else rather than "0 more files"', () => {
    expect(
      describeAssets({ imagesInDocument: 2, folder: { kind: 'counted', otherFiles: 0 } }),
    ).toBe('2 images used by this document · assets/ holds nothing else');
  });

  it('says there is no folder, without suggesting anything is wrong', () => {
    expect(describeAssets({ imagesInDocument: 2, folder: { kind: 'absent' } })).toBe(
      '2 images used by this document · there is no assets/ folder next to it',
    );
  });

  it('claims neither present nor absent when nothing was established', () => {
    const sentence = describeAssets({ imagesInDocument: 2, folder: { kind: 'unknown' } });
    expect(sentence).toBe(
      '2 images used by this document · assets/ could not be checked from here',
    );
    // The one wrong answer available here is a count, and the second is a
    // claim about which of the two causes it was.
    expect(sentence).not.toMatch(/\b0\b|empty|nothing/);
    expect(sentence).not.toMatch(/permission|grant|denied/);
  });

  it('says the folder arrives with the save, for a document never saved', () => {
    expect(describeAssets({ imagesInDocument: 1, folder: { kind: 'unsaved' } })).toBe(
      '1 image used by this document · assets/ arrives when you save this document',
    );
  });

  it('never warns, in any of the five sentences', () => {
    const all = [
      describeAssets({ imagesInDocument: 3, folder: { kind: 'counted', otherFiles: 9 } }),
      describeAssets({ imagesInDocument: 3, folder: { kind: 'counted', otherFiles: 0 } }),
      describeAssets({ imagesInDocument: 3, folder: { kind: 'absent' } }),
      describeAssets({ imagesInDocument: 3, folder: { kind: 'unknown' } }),
      describeAssets({ imagesInDocument: 3, folder: { kind: 'unsaved' } }),
    ];
    for (const sentence of all) {
      // "Information on demand, never a permanent warning" — and a shared
      // assets/ folder is the normal markdown convention, not a problem
      // state. Nothing here may read as one.
      expect(sentence).not.toMatch(/warn|error|problem|fail|invalid|missing|should/i);
    }
  });
});
