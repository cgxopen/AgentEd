/**
 * #729 - the broken link check over the resolver of #727. The links are read
 * from a real editor, the disk is a fake that says which paths are there, which
 * folders are shut, and records every question it is asked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
import * as linkTarget from '../platform/link-target';
import type { EntryPresence, FileEntry, PlatformIO } from '../platform/types';
import { establishedPresence } from './entry-absence';
import {
  checkLinks,
  collectLinks,
  type DocumentLink,
  MAX_CHECKED_LINKS,
  type NotCheckedReason,
} from './link-check';

vi.mock('../platform/link-target', async (original) => {
  const real = await original<typeof import('../platform/link-target')>();
  return { ...real, resolveLinkTarget: vi.fn(real.resolveLinkTarget) };
});

const DOC = 'C:/notes/docs/index.md';

interface FakeDisk {
  files?: string[];
  folders?: string[];
  /** Folders whose contents cannot be looked at: exists says no, listing throws. */
  shut?: string[];
  /** Every path answers unknown, as the web build with no folder granted. */
  unknown?: boolean;
}

function fakeIo(disk: FakeDisk) {
  const files = new Set(disk.files ?? []);
  const folders = new Set(['C:/notes', 'C:/notes/docs', ...(disk.folders ?? [])]);
  const shut = disk.shut ?? [];
  const inShut = (path: string) => shut.some((s) => path.startsWith(`${s}/`));
  const asked: string[] = [];
  const listed: string[] = [];
  const io = {
    entryPresence: vi.fn(async (path: string): Promise<EntryPresence> => {
      asked.push(path);
      if (disk.unknown) return 'unknown';
      // As `Path::exists()`: false for what cannot be looked at.
      if (inShut(path)) return 'absent';
      return files.has(path) || folders.has(path) ? 'present' : 'absent';
    }),
    listDir: vi.fn(async (path: string): Promise<FileEntry[]> => {
      listed.push(path);
      if (shut.includes(path)) throw new Error('permission denied');
      const prefix = path === '' ? '' : `${path}/`;
      const names = [...files, ...folders]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => p.slice(prefix.length))
        .filter((n) => n !== '');
      return names.map((name) => ({
        name,
        path: prefix + name,
        isDirectory: folders.has(prefix + name),
      }));
    }),
  } as unknown as PlatformIO;
  return { io, asked, listed };
}

const editors: EditorInstance[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = '';
  vi.mocked(linkTarget.resolveLinkTarget).mockClear();
});

function linksOf(markdown: string): DocumentLink[] {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editors.push(editor);
  editor.setMarkdown(markdown);
  return collectLinks(editor.editor.state.doc);
}

function link(href: string): DocumentLink {
  return { href, from: 0, to: 1, text: href, occurrence: 0 };
}

describe('the links the check reads from the document nodes (#729)', () => {
  it.each([
    ['an inline link', '[a](a.md)\n', ['a.md']],
    [
      'a reference link, by the address its definition gives',
      '[r][ref]\n\n[ref]: r.md\n',
      ['r.md'],
    ],
    ['a link written as raw HTML', 'see <a href="h.md">h</a>\n', ['h.md']],
    ['an image inside a link', '[![i](x.png)](t.md)\n', ['t.md']],
    ['a link in a table cell', '| a |\n|---|\n| [c](c.md) |\n', ['c.md']],
    [
      'a link in a heading, a list and a quote',
      '# [h](h.md)\n\n- [l](l.md)\n\n> [q](q.md)\n',
      ['h.md', 'l.md', 'q.md'],
    ],
    [
      'a web link and an autolink, read and left to the check to leave out',
      '[w](https://x.y) <https://a.b>\n',
      ['https://x.y', 'https://a.b'],
    ],
  ])('%s', (_name, markdown, hrefs) => {
    expect(linksOf(markdown).map((l) => l.href)).toEqual(hrefs);
  });

  it.each([
    ['a link in a code span', '`[c](c.md)`\n'],
    ['an image, which is not a link', '![i](x.png)\n'],
    ['a link with no text, kept as bytes (#564)', 'see [](./t.md) here\n'],
    ['a reference to no definition', '[nope][missing]\n'],
    ['a definition no link uses', 'text\n\n[unused]: u.md\n'],
    ['a link inside a footnote definition, drawn as its text', 'x[^1]\n\n[^1]: see [f](f.md)\n'],
  ])('%s gives no link', (_name, markdown) => {
    expect(linksOf(markdown)).toEqual([]);
  });

  it('reads a link with emphasis inside it as one link, its text whole', () => {
    const links = linksOf('[plain **bold** end](a.md)\n');
    expect(links.map((l) => [l.href, l.text])).toEqual([['a.md', 'plain bold end']]);
  });

  it('counts two links to one address apart, in document order', () => {
    const links = linksOf('[one](a.md) and [two](a.md)\n');
    expect(links.map((l) => [l.text, l.occurrence])).toEqual([
      ['one', 0],
      ['two', 1],
    ]);
    expect(links[0].to).toBeLessThanOrEqual(links[1].from);
  });
});

async function check(hrefs: string[], disk: FakeDisk, documentPath: string | null = DOC) {
  const fake = fakeIo(disk);
  const result = await checkLinks(documentPath, hrefs.map(link), fake.io);
  return { ...fake, result };
}

describe('what the check says of each link (#729)', () => {
  it('a target that is not there is broken, naming the path the resolver gave', async () => {
    const { result } = await check(['../gone.md'], {});
    expect(result.broken.map((b) => b.path)).toEqual(['C:/notes/gone.md']);
    expect(result.notChecked).toEqual([]);
    expect(result.good).toBe(0);
  });

  it('a target that is there is good, and listed nowhere', async () => {
    const { result } = await check(['a.md', './sub/b.pdf'], {
      files: ['C:/notes/docs/a.md', 'C:/notes/docs/sub/b.pdf'],
      folders: ['C:/notes/docs/sub'],
    });
    expect(result).toMatchObject({ broken: [], notChecked: [], good: 2 });
    // Since #797 the result keeps each found link with its path, what Links to lists.
    expect(result.found.map((f) => [f.link.href, f.path])).toEqual([
      ['a.md', 'C:/notes/docs/a.md'],
      ['./sub/b.pdf', 'C:/notes/docs/sub/b.pdf'],
    ]);
  });

  it('a link with a heading is checked by its file', async () => {
    const { result } = await check(['a.md#setup', 'gone.md#x'], { files: ['C:/notes/docs/a.md'] });
    expect(result.good).toBe(1);
    expect(result.broken.map((b) => b.path)).toEqual(['C:/notes/docs/gone.md']);
  });

  it.each<[string, string, NotCheckedReason, string | null]>([
    ['a heading alone', '#setup', 'anchor-only', DOC],
    ['a link that starts with /', '/a.md', 'rooted', DOC],
    ['any link of a document never saved', 'a.md', 'no-document', null],
    ['a folder', 'sub/', 'folder', DOC],
    ['above the top folder of the disk', '../../../x.md', 'above-root', DOC],
  ])('%s is not checked, with its reason', async (_name, href, reason, documentPath) => {
    const { result, asked } = await check([href], {}, documentPath);
    expect(result.notChecked.map((u) => u.reason)).toEqual([reason]);
    expect(result.broken).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('a target whose presence is unknown is not checked, never broken', async () => {
    const { result } = await check(['a.md', 'gone.md'], { unknown: true });
    expect(result.broken).toEqual([]);
    expect(result.notChecked.map((u) => u.reason)).toEqual(['unknown', 'unknown']);
  });

  it('a file in a folder that cannot be looked at is not checked, never broken', async () => {
    const { result } = await check(['shut/a.md'], {
      folders: ['C:/notes/docs/shut'],
      shut: ['C:/notes/docs/shut'],
    });
    expect(result.broken).toEqual([]);
    expect(result.notChecked.map((u) => u.reason)).toEqual(['unknown']);
  });

  it('a file in a folder that is not there is broken', async () => {
    const { result } = await check(['gone/deeper/a.md'], {});
    expect(result.broken.map((b) => b.path)).toEqual(['C:/notes/docs/gone/deeper/a.md']);
  });

  it('past the bound, the rest are not checked, by that reason', async () => {
    const hrefs = Array.from({ length: MAX_CHECKED_LINKS + 2 }, (_, i) => `f${i}.md`);
    const { result } = await check(hrefs, {});
    expect(result.broken).toHaveLength(MAX_CHECKED_LINKS);
    expect(result.notChecked.map((u) => u.reason)).toEqual(['too-many', 'too-many']);
  });

  it('asks once for a target many links name', async () => {
    const { asked, result } = await check(['a.md', './a.md', 'a.md#x'], {
      files: ['C:/notes/docs/a.md'],
    });
    expect(asked).toEqual(['C:/notes/docs/a.md']);
    expect(result.good).toBe(3);
  });

  it('asks once of a folder that many missing targets share, and lists it once', async () => {
    const { asked, listed, result } = await check(['m1.md', 'm2.md', 'm3.md'], {});
    expect(result.broken).toHaveLength(3);
    expect(asked.filter((p) => p === 'C:/notes/docs')).toHaveLength(1);
    expect(listed).toEqual(['C:/notes/docs']);
  });

  it('lists the links not checked in document order', async () => {
    const links = [
      { ...link('#h'), from: 30 },
      { ...link('/a.md'), from: 10 },
      { ...link('sub/'), from: 20 },
    ];
    const { io } = fakeIo({});
    const result = await checkLinks(DOC, links, io);
    expect(result.notChecked.map((u) => u.link.href)).toEqual(['/a.md', 'sub/', '#h']);
  });
});

describe('web addresses are never looked at (#729, Q3)', () => {
  const WEB = ['https://example.com/a.md', 'http://x.y', 'mailto:a@b.c', '//host/share/x.md'];

  it('asks nothing of the disk, never asks the resolver, and lists them nowhere', async () => {
    const { result, asked, listed } = await check(WEB, {});
    expect(result).toEqual({ broken: [], notChecked: [], good: 0, found: [] });
    expect(asked).toEqual([]);
    expect(listed).toEqual([]);
    expect(linkTarget.resolveLinkTarget).not.toHaveBeenCalled();
  });
});

describe('absent is said only where the disk was seen not to hold the file (#729)', () => {
  it('the folder above is listed and does not hold the name: absent', async () => {
    const { io, listed } = fakeIo({});
    expect(await establishedPresence(io, 'C:/notes/docs/gone.md')).toBe('absent');
    expect(listed).toEqual(['C:/notes/docs']);
  });

  it('the folder above cannot be listed: unknown', async () => {
    const { io } = fakeIo({ folders: ['C:/notes/docs/shut'], shut: ['C:/notes/docs/shut'] });
    expect(await establishedPresence(io, 'C:/notes/docs/shut/a.md')).toBe('unknown');
  });

  it('the listing holds the name the disk said was not there: unknown', async () => {
    const { io } = fakeIo({ files: ['C:/notes/docs/a.md'] });
    vi.mocked(io.entryPresence).mockResolvedValueOnce('absent');
    expect(await establishedPresence(io, 'C:/notes/docs/a.md')).toBe('unknown');
  });

  it('a path in the folder the web build was granted lists that folder at its top', async () => {
    const { io, listed } = fakeIo({ folders: [] });
    expect(await establishedPresence(io, 'gone.md')).toBe('absent');
    expect(listed).toEqual(['']);
  });

  it('never lists a root: a drive alone names another folder on Windows', async () => {
    const { io, listed } = fakeIo({});
    vi.mocked(io.entryPresence).mockResolvedValue('absent');
    expect(await establishedPresence(io, 'C:/gone/x.md')).toBe('unknown');
    expect(listed).toEqual([]);
  });
});
