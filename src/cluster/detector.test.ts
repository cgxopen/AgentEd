import { describe, expect, it } from 'vitest';
import type {
  EntryPresence,
  FileEntry,
  FileResult,
  FileSnapshot,
  PickedFile,
  PlatformIO,
} from '../platform/types';
import { detectContextCluster, MAX_CHILDREN, MAX_RESULTS } from './detector';

/**
 * In-memory `PlatformIO` for cluster tests. Only the methods the
 * detector touches (`entryPresence`, `listDir`) are wired up; the rest
 * throw so accidental coupling shows up loudly.
 */
class FakeIO implements PlatformIO {
  readonly supportsMultiFile = false;

  async canWriteCompanions(): Promise<boolean> {
    return false;
  }
  readonly files: Set<string>;
  readonly dirs: Map<string, FileEntry[]>;
  readonly listDirCalls: string[] = [];
  readonly existsCalls: string[] = [];
  /** When set, any path under one of these prefixes throws on listDir. */
  readonly forbiddenDirPrefixes: string[] = [];

  constructor(files: string[], dirs: Record<string, string[]>) {
    this.files = new Set(files);
    this.dirs = new Map();
    for (const [parent, children] of Object.entries(dirs)) {
      const entries: FileEntry[] = children.map((name) => {
        const isDir = name.endsWith('/');
        const cleanName = isDir ? name.slice(0, -1) : name;
        const path = `${parent}/${cleanName}`;
        return { name: cleanName, path, isDirectory: isDir };
      });
      this.dirs.set(parent, entries);
    }
  }

  /** When set, any path under one of these prefixes cannot be looked up. */
  readonly unknownPrefixes: string[] = [];

  async entryPresence(path: string): Promise<EntryPresence> {
    this.existsCalls.push(path);
    if (this.unknownPrefixes.some((p) => path.startsWith(p))) return 'unknown';
    return this.files.has(path) ? 'present' : 'absent';
  }

  async listDir(path: string): Promise<FileEntry[]> {
    this.listDirCalls.push(path);
    if (this.forbiddenDirPrefixes.some((p) => path.startsWith(p))) {
      throw new Error(`EACCES: ${path}`);
    }
    return this.dirs.get(path) ?? [];
  }

  async openFile(): Promise<FileResult | null> {
    throw new Error('not implemented');
  }
  async pickFile(): Promise<PickedFile | null> {
    throw new Error('not implemented');
  }
  async readText(): Promise<string> {
    throw new Error('not implemented');
  }
  async saveFile(): Promise<void> {
    throw new Error('not implemented');
  }
  async readSnapshot(): Promise<FileSnapshot> {
    throw new Error('not implemented');
  }
  async pickSavePath(): Promise<string | null> {
    throw new Error('not implemented');
  }
  async installCloseGuard(): Promise<void> {
    throw new Error('not implemented');
  }
  async readBinary(): Promise<Uint8Array> {
    throw new Error('not implemented');
  }
  async writeBinary(): Promise<void> {
    throw new Error('not implemented');
  }
  async mkdir(): Promise<void> {
    throw new Error('not implemented');
  }
  async openWithSystem(): Promise<void> {
    throw new Error('not implemented');
  }
}

describe('detectContextCluster — empty / degenerate inputs', () => {
  it('returns an empty cluster for an empty path', async () => {
    const io = new FakeIO([], {});
    const cluster = await detectContextCluster('', io);
    expect(cluster.relatedCount).toBe(0);
  });

  it('returns an empty cluster when no canonical files exist anywhere', async () => {
    const io = new FakeIO(['/repo/notes/foo.md'], { '/repo/notes': [], '/repo': ['notes/'] });
    const cluster = await detectContextCluster('/repo/notes/foo.md', io);
    expect(cluster.relatedCount).toBe(0);
  });

  it('skips the open document itself (no self-references)', async () => {
    const io = new FakeIO(['/repo/AGENTS.md'], { '/repo': [], '/': ['repo/'] });
    const cluster = await detectContextCluster('/repo/AGENTS.md', io);
    expect(cluster.entries.find((e) => e.path === '/repo/AGENTS.md')).toBeUndefined();
  });
});

describe('detectContextCluster — ancestors only', () => {
  it('walks up to find canonical files in parent directories', async () => {
    const io = new FakeIO(['/repo/AGENTS.md', '/repo/frontend/AGENTS.md'], {
      '/repo/frontend': [],
      '/repo': ['frontend/'],
    });
    const cluster = await detectContextCluster('/repo/frontend/AGENTS.md', io);

    const parent = cluster.entries.find((e) => e.path === '/repo/AGENTS.md');
    expect(parent).toBeDefined();
    expect(parent?.direction).toBe('ancestor');
    expect(parent?.distance).toBe(1);
    expect(parent?.relativePath).toBe('../AGENTS.md');
  });

  it('caps walk-up at MAX_DEPTH_UP=5', async () => {
    // 7-level deep file; canonical at level 6 (one beyond cap) should be missed.
    const files = ['/a/b/c/d/e/f/g/file.md', '/a/AGENTS.md', '/a/b/AGENTS.md'];
    const io = new FakeIO(files, {
      '/a/b/c/d/e/f/g': [],
      '/a/b/c/d/e/f': ['g/'],
      '/a/b/c/d/e': ['f/'],
      '/a/b/c/d': ['e/'],
      '/a/b/c': ['d/'],
      '/a/b': ['c/'],
      '/a': ['b/'],
    });
    const cluster = await detectContextCluster('/a/b/c/d/e/f/g/file.md', io);

    expect(cluster.entries.some((e) => e.path === '/a/b/AGENTS.md')).toBe(true);
    expect(cluster.entries.some((e) => e.path === '/a/AGENTS.md')).toBe(false);
  });
});

describe('detectContextCluster — children', () => {
  it('finds canonical files in immediate child directories', async () => {
    const io = new FakeIO(
      ['/repo/AGENTS.md', '/repo/backend/AGENTS.md', '/repo/frontend/AGENTS.md'],
      {
        '/repo': ['backend/', 'frontend/'],
        '/repo/backend': [],
        '/repo/frontend': [],
        '/': ['repo/'],
      },
    );
    const cluster = await detectContextCluster('/repo/AGENTS.md', io);

    const backend = cluster.entries.find((e) => e.path === '/repo/backend/AGENTS.md');
    const frontend = cluster.entries.find((e) => e.path === '/repo/frontend/AGENTS.md');
    expect(backend?.direction).toBe('child');
    expect(backend?.distance).toBe(1);
    expect(frontend?.direction).toBe('child');
  });

  it('handles ancestors + children together', async () => {
    const io = new FakeIO(
      [
        '/repo/AGENTS.md',
        '/repo/frontend/AGENTS.md',
        '/repo/frontend/src/AGENTS.md',
        '/repo/backend/AGENTS.md',
        '/repo/shared/AGENTS.md',
      ],
      {
        '/repo/frontend': ['src/'],
        '/repo/frontend/src': [],
        '/repo': ['frontend/', 'backend/', 'shared/'],
        '/repo/backend': [],
        '/repo/shared': [],
        '/': ['repo/'],
      },
    );
    const cluster = await detectContextCluster('/repo/frontend/AGENTS.md', io);

    // `backend/` and `shared/` are on disk and are peers of the document's
    // directory. They are not reported and their parent is never listed.
    const paths = cluster.entries.map((e) => e.path).sort();
    expect(paths).toEqual(['/repo/AGENTS.md', '/repo/frontend/src/AGENTS.md']);
  });
});

/**
 * #132 — the peer round is gone, and gone means not run rather than
 * filtered.
 *
 * The distinction is the whole point of the change. The issue argues the
 * scan on how much disk it reads: ancestors are the lineage of the open
 * document, while the other children of its parent are a different subtree
 * read only because it is adjacent. A filter over results would go on
 * reading that subtree and merely stop showing it, which answers none of
 * that — so the assertion below is on the `listDir` calls, by argument, and
 * not only on what came back.
 *
 * One fixture carries both halves. A wrong deletion that took the whole
 * scan with it would satisfy the narrow half and fail the wide one.
 */
describe('detectContextCluster — the parent is not listed (#132)', () => {
  /**
   *   /work/CLAUDE.md                    grandparent, distance 2
   *   /work/repo/CLAUDE.md               parent, distance 1
   *   /work/repo/frontend/doc.md         the open document
   *   /work/repo/frontend/CLAUDE.md      same directory, distance 0
   *   /work/repo/frontend/sub/CLAUDE.md  child, distance 1
   *   /work/repo/backend/AGENTS.md       peer — the one that must go
   */
  function fixture(): FakeIO {
    return new FakeIO(
      [
        '/work/CLAUDE.md',
        '/work/repo/CLAUDE.md',
        '/work/repo/frontend/doc.md',
        '/work/repo/frontend/CLAUDE.md',
        '/work/repo/frontend/sub/CLAUDE.md',
        '/work/repo/backend/AGENTS.md',
      ],
      {
        '/work/repo/frontend': ['sub/'],
        '/work/repo/frontend/sub': [],
        '/work/repo': ['frontend/', 'backend/'],
        '/work/repo/backend': [],
        '/work': ['repo/'],
        '/': ['work/'],
      },
    );
  }

  const DOC = '/work/repo/frontend/doc.md';

  it('does not report a context file in a peer directory', async () => {
    const io = fixture();
    const cluster = await detectContextCluster(DOC, io);

    // The file is genuinely on disk and `listDir('/work/repo')` genuinely
    // returns `backend/`, so this passes only by the round being gone.
    expect(io.files.has('/work/repo/backend/AGENTS.md')).toBe(true);
    expect((await io.listDir('/work/repo')).map((e) => e.name)).toContain('backend');

    expect(cluster.entries.some((e) => e.path === '/work/repo/backend/AGENTS.md')).toBe(false);
  });

  it('never lists the parent directory — a removal, not a filter', async () => {
    const io = fixture();
    await detectContextCluster(DOC, io);

    // Asserted on the calls by argument: the subtree is not read at all.
    // Each test builds its own fixture, so these are the scan's calls and
    // nothing else's.
    expect(io.listDirCalls).toContain('/work/repo/frontend');
    expect(io.listDirCalls).not.toContain('/work/repo');
    expect(io.listDirCalls).not.toContain('/work');
  });

  it('still reports the same directory, the parent, further up, and a child', async () => {
    const io = fixture();
    const cluster = await detectContextCluster(DOC, io);
    const at = (path: string) => cluster.entries.find((e) => e.path === path);

    // Each asserted separately, so a wrong deletion names itself.
    expect(at('/work/repo/frontend/CLAUDE.md')?.direction).toBe('self');
    expect(at('/work/repo/CLAUDE.md')?.direction).toBe('ancestor');
    expect(at('/work/CLAUDE.md')?.direction).toBe('ancestor');
    expect(at('/work/repo/frontend/sub/CLAUDE.md')?.direction).toBe('child');

    expect(at('/work/repo/CLAUDE.md')?.distance).toBe(1);
    expect(at('/work/CLAUDE.md')?.distance).toBe(2);
    expect(at('/work/repo/frontend/sub/CLAUDE.md')?.relativePath).toBe('sub/CLAUDE.md');
  });
});

describe('detectContextCluster — multiple kinds in one directory', () => {
  it('finds AGENTS.md, CLAUDE.md and .cursorrules side-by-side', async () => {
    const io = new FakeIO(
      ['/repo/AGENTS.md', '/repo/CLAUDE.md', '/repo/.cursorrules', '/repo/notes/foo.md'],
      {
        '/repo/notes': [],
        '/repo': ['notes/'],
      },
    );
    const cluster = await detectContextCluster('/repo/notes/foo.md', io);

    const kinds = cluster.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(['agents-md', 'claude-md', 'cursor-rules']);
  });
});

describe('detectContextCluster — sort and cap', () => {
  it('sorts results by ascending distance', async () => {
    const io = new FakeIO(
      ['/a/AGENTS.md', '/a/b/AGENTS.md', '/a/b/c/AGENTS.md', '/a/b/c/d/file.md'],
      {
        '/a/b/c/d': [],
        '/a/b/c': ['d/'],
        '/a/b': ['c/'],
        '/a': ['b/'],
      },
    );
    const cluster = await detectContextCluster('/a/b/c/d/file.md', io);

    const distances = cluster.entries.map((e) => e.distance);
    const sorted = [...distances].sort((x, y) => x - y);
    expect(distances).toEqual(sorted);
  });

  it('caps results at MAX_RESULTS', async () => {
    // Synthesise > MAX_RESULTS canonical files spread over many children.
    // This fixture was built out of sibling directories until #132 removed
    // that round; children are the only listed direction that can still
    // produce more hits than the cap.
    const children: string[] = [];
    const files: string[] = [];
    for (let i = 0; i < MAX_RESULTS + 5; i++) {
      children.push(`c${i}/`);
      files.push(`/repo/me/c${i}/AGENTS.md`);
    }
    const dirs: Record<string, string[]> = {
      '/repo/me': children,
      '/repo': ['me/'],
    };
    for (const c of children) {
      dirs[`/repo/me/${c.slice(0, -1)}`] = [];
    }
    const io = new FakeIO(['/repo/me/AGENTS.md', ...files], dirs);
    const cluster = await detectContextCluster('/repo/me/AGENTS.md', io);
    expect(cluster.relatedCount).toBe(MAX_RESULTS);
  });

  it('skips hidden / build directories when walking children', async () => {
    const io = new FakeIO(
      ['/repo/AGENTS.md', '/repo/node_modules/AGENTS.md', '/repo/.git/AGENTS.md'],
      {
        '/repo': ['node_modules/', '.git/', 'src/'],
        '/repo/src': [],
        '/repo/node_modules': [],
        '/repo/.git': [],
      },
    );
    const cluster = await detectContextCluster('/repo/AGENTS.md', io);
    expect(cluster.entries.some((e) => e.path.includes('/node_modules/'))).toBe(false);
    expect(cluster.entries.some((e) => e.path.includes('/.git/'))).toBe(false);
  });

  it('caps children listed per parent at MAX_CHILDREN', async () => {
    const children: string[] = [];
    const dirs: Record<string, string[]> = { '/repo': [] };
    for (let i = 0; i < MAX_CHILDREN + 10; i++) {
      children.push(`d${i}/`);
      dirs[`/repo/d${i}`] = [];
    }
    dirs['/repo'] = children;
    const io = new FakeIO([], dirs);
    await detectContextCluster('/repo/AGENTS.md', io);
    // listDir on /repo returns N entries; detector stops asking after MAX_CHILDREN.
    // We can verify the cap indirectly: existsCalls scoped to /repo/d*/<filename> should be
    // bounded by MAX_CHILDREN * canonical_count.
    const probesUnderRepo = io.existsCalls.filter((p) => p.startsWith('/repo/d'));
    // 6 canonical filenames per scanned dir.
    expect(probesUnderRepo.length).toBeLessThanOrEqual(MAX_CHILDREN * 6);
  });
});

describe('detectContextCluster — error tolerance', () => {
  it('returns partial results when a parent directory listing fails', async () => {
    const io = new FakeIO(['/repo/AGENTS.md', '/repo/frontend/AGENTS.md'], {
      '/repo/frontend': [],
      '/repo': ['frontend/'],
    });
    io.forbiddenDirPrefixes.push('/');
    const cluster = await detectContextCluster('/repo/frontend/AGENTS.md', io);
    // The /repo listing is forbidden but we still find the parent's
    // AGENTS.md by probing the ancestors directly.
    expect(cluster.entries.some((e) => e.path === '/repo/AGENTS.md')).toBe(true);
  });

  it('does not throw when a probe rejects', async () => {
    const io = new FakeIO(['/repo/AGENTS.md'], {
      '/repo': [],
    });
    const original = io.entryPresence.bind(io);
    io.entryPresence = async (p: string) => {
      if (p === '/repo/CLAUDE.md') throw new Error('boom');
      return original(p);
    };
    await expect(detectContextCluster('/repo/notes.md', io)).resolves.toBeDefined();
  });
});

describe('detectContextCluster — edge cases (M3)', () => {
  it('returns partial results when probes exceed the timeout', async () => {
    // Simulate a slow probe that always takes longer than the timeout.
    const io = new FakeIO(['/repo/AGENTS.md', '/repo/CLAUDE.md', '/repo/.cursorrules'], {
      '/repo': [],
    });
    const slow = io.entryPresence.bind(io);
    io.entryPresence = async (p: string) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return slow(p);
    };
    const cluster = await detectContextCluster('/repo/notes.md', io, { timeoutMs: 5 });
    // We may end up with 0 entries (timeout fires first) — the
    // important invariant is that the function resolves promptly
    // without throwing.
    expect(cluster.relatedCount).toBeGreaterThanOrEqual(0);
    expect(cluster.relatedCount).toBeLessThanOrEqual(3);
  });

  it('terminates even when the parent chain forms a symlink loop', async () => {
    // /repo/loop/loop/... — every dirname returns '/repo/loop' itself.
    // We can't reproduce that with `dirname` alone (it actually trims a
    // segment), but the depth cap means the walk halts after 5 steps
    // regardless of cycles in listDir entries.
    const dirs: Record<string, string[]> = {};
    for (let i = 0; i <= 10; i++) {
      const path = `/repo${'/loop'.repeat(i)}`;
      dirs[path] = i < 10 ? [`loop/`] : [];
    }
    const io = new FakeIO([], dirs);
    const cluster = await detectContextCluster('/repo/loop/loop/loop/loop/loop/loop/file.md', io);
    expect(cluster.relatedCount).toBe(0);
    // The detector listed at most ~MAX_DEPTH_UP+2 distinct dirs.
    const unique = new Set(io.listDirCalls).size;
    expect(unique).toBeLessThanOrEqual(MAX_RESULTS);
  });

  it('collapses caller-supplied `..` segments before walking', async () => {
    // `/repo/foo/../AGENTS.md` should resolve to `/repo/AGENTS.md` and
    // be skipped as the open document — not double-counted via aliases.
    const io = new FakeIO(['/repo/AGENTS.md', '/repo/sub/AGENTS.md'], {
      '/repo': ['sub/'],
      '/repo/sub': [],
    });
    const cluster = await detectContextCluster('/repo/foo/../AGENTS.md', io);
    expect(cluster.entries.find((e) => e.path === '/repo/AGENTS.md')).toBeUndefined();
    expect(cluster.entries.some((e) => e.path === '/repo/sub/AGENTS.md')).toBe(true);
  });

  it('handles a path-traversal attempt via . segments cleanly', async () => {
    const io = new FakeIO(['/repo/AGENTS.md'], { '/repo': [] });
    const cluster = await detectContextCluster('/repo/./notes/./foo.md', io);
    // Should still find /repo/AGENTS.md as ancestor (via collapsed
    // `/repo/notes` → ancestor /repo).
    expect(cluster.entries.some((e) => e.path === '/repo/AGENTS.md')).toBe(true);
  });
});

describe('detectContextCluster — relative path rendering', () => {
  it('renders parent files with ../', async () => {
    const io = new FakeIO(['/a/AGENTS.md'], { '/a': [], '/a/b': [] });
    const cluster = await detectContextCluster('/a/b/file.md', io);
    expect(cluster.entries[0]?.relativePath).toBe('../AGENTS.md');
  });

  it('renders child files with child/name', async () => {
    const io = new FakeIO(['/a/sub/AGENTS.md'], { '/a': ['sub/'], '/a/sub': [] });
    const cluster = await detectContextCluster('/a/AGENTS.md', io);
    const child = cluster.entries.find((e) => e.path === '/a/sub/AGENTS.md');
    expect(child?.relativePath).toBe('sub/AGENTS.md');
  });
});
