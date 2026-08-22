/**
 * Round-trip coverage for the on-disk format (R-C2): loading a document
 * and saving it back with no edits must reproduce the original bytes,
 * and saving must never add anything the user did not write — no
 * frontmatter injection, no sidecar files.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, FileResult, FileSnapshot, PlatformIO } from '../platform/types';
import { DEFAULT_LINE_CONVENTIONS } from './line-conventions';
import { loadMarkdown, saveMarkdown } from './plain';

function stubIO(files: Record<string, string>): PlatformIO & {
  written: Map<string, string>;
  binaries: Map<string, Uint8Array>;
  dirs: string[];
} {
  const written = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  const dirs: string[] = [];
  return {
    supportsMultiFile: true,
    written,
    binaries,
    dirs,
    openFile: async (): Promise<FileResult | null> => null,
    pickFile: async () => null,
    readText: async (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
    saveFile: async (path: string, content: string) => {
      written.set(path, content);
    },
    readSnapshot: async (path: string): Promise<FileSnapshot> => {
      const text = written.get(path) ?? files[path];
      return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
    },
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async (path: string, data: Uint8Array) => {
      binaries.set(path, data);
    },
    exists: async () => false,
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async (path: string) => {
      dirs.push(path);
    },
    remove: async () => {},
    openWithSystem: vi.fn(async () => {}),
  };
}

const DOCUMENTS: ReadonlyArray<{ label: string; text: string }> = [
  { label: 'plain body', text: '# Title\n\nSome text.\n' },
  {
    label: 'body with frontmatter',
    text: '---\ntitle: Notes\ntags: []\n---\n# Title\n\nSome text.\n',
  },
  { label: 'body with a table and a task list', text: '| a | b |\n| --- | --- |\n\n- [ ] todo\n' },
  { label: 'empty document', text: '' },
];

describe('open → save with no edits', () => {
  for (const doc of DOCUMENTS) {
    it(`is byte-identical for a ${doc.label}`, async () => {
      const io = stubIO({ '/docs/notes.md': doc.text });
      const { bundle } = await loadMarkdown('/docs/notes.md', io);
      await saveMarkdown(bundle, io);
      expect(io.written.get('/docs/notes.md')).toBe(doc.text);
    });
  }

  it('never adds a metadata block to a document that had none', async () => {
    const io = stubIO({ '/docs/notes.md': '# Just a heading\n' });
    const { bundle } = await loadMarkdown('/docs/notes.md', io);
    expect(bundle.frontmatterRaw).toBeNull();
    await saveMarkdown(bundle, io);
    expect(io.written.get('/docs/notes.md')).not.toContain('---');
  });

  it('writes only the .md file when the document has no images', async () => {
    const io = stubIO({ '/docs/notes.md': '# Heading\n' });
    const { bundle } = await loadMarkdown('/docs/notes.md', io);
    await saveMarkdown(bundle, io);
    expect([...io.written.keys()]).toEqual(['/docs/notes.md']);
    expect(io.binaries.size).toBe(0);
    expect(io.dirs).toEqual([]);
  });
});

describe('saveMarkdown — images', () => {
  it('writes assets/ images next to the document', async () => {
    const io = stubIO({});
    await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '![shot](assets/shot.png)\n',
        images: [
          {
            relativePath: 'assets/shot.png',
            data: new Uint8Array([1, 2, 3]),
            filename: 'shot.png',
          },
        ],
        rootPath: '/docs/notes.md',
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );
    expect(io.dirs).toEqual(['/docs/assets']);
    expect(io.binaries.has('/docs/assets/shot.png')).toBe(true);
  });

  it('creates assets/ here and nowhere else — the folder appears on save (#14)', async () => {
    const io = stubIO({});
    expect(io.dirs).toEqual([]);
    await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '![shot](assets/shot.png)\n',
        images: [{ relativePath: 'assets/shot.png', data: new Uint8Array([1]), filename: 's.png' }],
        rootPath: '/docs/notes.md',
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );
    expect(io.dirs).toEqual(['/docs/assets']);
  });

  /**
   * The deliberate outcome for #14: the document is written first and is
   * never rolled back for the sake of its images. A failure to create the
   * folder is reported to the caller, not thrown — the .md is already on
   * disk and AgentEd does not un-write or delete files.
   */
  it('keeps the saved document when the assets folder cannot be created', async () => {
    const io = stubIO({});
    io.mkdir = async () => {
      throw new Error('EACCES: permission denied');
    };

    const result = await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '# Notes\n\n![shot](assets/shot.png)\n',
        images: [{ relativePath: 'assets/shot.png', data: new Uint8Array([1]), filename: 's.png' }],
        rootPath: '/docs/notes.md',
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );

    expect(io.written.get('/docs/notes.md')).toBe('# Notes\n\n![shot](assets/shot.png)\n');
    expect(io.binaries.size).toBe(0);
    expect((result.assetsError as Error).message).toContain('EACCES');
  });

  it('reports a failed image write the same way, without losing the document', async () => {
    const io = stubIO({});
    io.writeBinary = async () => {
      throw new Error('ENOSPC: no space left on device');
    };

    const result = await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '![shot](assets/shot.png)\n',
        images: [{ relativePath: 'assets/shot.png', data: new Uint8Array([1]), filename: 's.png' }],
        rootPath: '/docs/notes.md',
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );

    expect(io.written.has('/docs/notes.md')).toBe(true);
    expect((result.assetsError as Error).message).toContain('ENOSPC');
  });

  it('still throws when the document itself cannot be written — that save did not happen', async () => {
    const io = stubIO({});
    io.saveFile = async () => {
      throw new Error('EACCES: permission denied');
    };

    await expect(
      saveMarkdown(
        {
          frontmatterRaw: null,
          markdownBody: '# Notes\n',
          images: [],
          rootPath: '/docs/notes.md',
          lineConventions: DEFAULT_LINE_CONVENTIONS,
        },
        io,
      ),
    ).rejects.toThrow('EACCES');
  });

  it('reports no error when everything lands', async () => {
    const io = stubIO({});
    const result = await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '![shot](assets/shot.png)\n',
        images: [{ relativePath: 'assets/shot.png', data: new Uint8Array([1]), filename: 's.png' }],
        rootPath: '/docs/notes.md',
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );
    expect(result.assetsError).toBeNull();
  });

  it('ignores images registered outside assets/ — never scribbles on user paths', async () => {
    const io = stubIO({});
    await saveMarkdown(
      {
        frontmatterRaw: null,
        markdownBody: '![logo](../shared/logo.png)\n',
        images: [
          {
            relativePath: '../shared/logo.png',
            data: new Uint8Array([9]),
            filename: 'logo.png',
          },
        ],
        rootPath: '/docs/notes.md',
        lineConventions: DEFAULT_LINE_CONVENTIONS,
      },
      io,
    );
    expect(io.binaries.size).toBe(0);
    expect(io.dirs).toEqual([]);
  });
});
