import { describe, expect, it } from 'vitest';
import {
  basename,
  collapseDotSegments,
  decodePercentEscapes,
  dirname,
  isPathInsideRoot,
  joinPath,
  normalize,
  samePath,
  stripExtension,
} from './paths';

describe('normalize', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalize('foo\\bar\\baz')).toBe('foo/bar/baz');
  });
  it('leaves forward-slash paths untouched', () => {
    expect(normalize('foo/bar')).toBe('foo/bar');
  });
  it('handles empty string', () => {
    expect(normalize('')).toBe('');
  });
});

describe('basename', () => {
  it('returns last segment of a unix path', () => {
    expect(basename('/foo/bar/baz.md')).toBe('baz.md');
  });
  it('returns last segment of a windows path', () => {
    expect(basename('C:\\Users\\user\\doc.md')).toBe('doc.md');
  });
  it('returns full path when no separator', () => {
    expect(basename('doc.md')).toBe('doc.md');
  });
  it('ignores trailing slashes', () => {
    expect(basename('/foo/bar/')).toBe('bar');
  });
  it('handles empty string', () => {
    expect(basename('')).toBe('');
  });
});

describe('dirname', () => {
  it('returns parent of a unix path', () => {
    expect(dirname('/foo/bar/baz.md')).toBe('/foo/bar');
  });
  it('returns parent of a relative path', () => {
    expect(dirname('foo/bar/baz.md')).toBe('foo/bar');
  });
  it('returns empty for filename-only input', () => {
    expect(dirname('baz.md')).toBe('');
  });
  it('returns "/" for root-level file', () => {
    expect(dirname('/foo')).toBe('/');
  });
  it('ignores trailing slash', () => {
    expect(dirname('/foo/bar/')).toBe('/foo');
  });
  it('normalizes backslashes', () => {
    expect(dirname('C:\\Users\\user\\doc.md')).toBe('C:/Users/user');
  });
});

describe('stripExtension', () => {
  it('removes single extension', () => {
    expect(stripExtension('doc.md')).toBe('doc');
  });
  it('removes only the final extension', () => {
    expect(stripExtension('archive.tar.gz')).toBe('archive.tar');
  });
  it('leaves extensionless paths untouched', () => {
    expect(stripExtension('README')).toBe('README');
  });
  it('does not strip dot segments in directories', () => {
    expect(stripExtension('/foo.bar/baz')).toBe('/foo.bar/baz');
  });
});

describe('joinPath', () => {
  it('joins simple segments', () => {
    expect(joinPath('foo', 'bar', 'baz')).toBe('foo/bar/baz');
  });
  it('preserves leading slash on absolute paths', () => {
    expect(joinPath('/home/user', 'docs', 'file.md')).toBe('/home/user/docs/file.md');
  });
  it('removes trailing slashes from segments', () => {
    expect(joinPath('/home/user/', 'docs/', 'file.md')).toBe('/home/user/docs/file.md');
  });
  it('removes leading slashes from inner segments', () => {
    expect(joinPath('foo', '/bar', '/baz')).toBe('foo/bar/baz');
  });
  it('drops empty segments', () => {
    expect(joinPath('foo', '', 'bar', '')).toBe('foo/bar');
  });
  it('normalizes backslashes in inputs', () => {
    expect(joinPath('foo\\bar', 'baz')).toBe('foo/bar/baz');
  });
  it('returns empty for all-empty input', () => {
    expect(joinPath('', '')).toBe('');
  });
});

describe('collapseDotSegments', () => {
  it('removes "." segments', () => {
    expect(collapseDotSegments('/foo/./bar')).toBe('/foo/bar');
  });
  it('collapses ".." by popping the previous segment', () => {
    expect(collapseDotSegments('/foo/bar/../baz')).toBe('/foo/baz');
  });
  it('drops ".." that escapes past the root', () => {
    expect(collapseDotSegments('/foo/../../bar')).toBe('/bar');
  });
  it('preserves the leading slash for absolute paths', () => {
    expect(collapseDotSegments('/a/b/c')).toBe('/a/b/c');
  });
  it('keeps relative paths relative', () => {
    expect(collapseDotSegments('a/b/c')).toBe('a/b/c');
  });
});

describe('isPathInsideRoot', () => {
  it('returns true when target equals root', () => {
    expect(isPathInsideRoot('/proj/notes', '/proj/notes')).toBe(true);
  });
  it('returns true for a file inside root', () => {
    expect(isPathInsideRoot('/proj/notes/foo.md', '/proj/notes')).toBe(true);
  });
  it('returns true for a deeply nested file inside root', () => {
    expect(isPathInsideRoot('/proj/notes/assets/img/foo.png', '/proj/notes')).toBe(true);
  });
  it('rejects a sibling that shares a prefix', () => {
    expect(isPathInsideRoot('/proj/notes-other/x.md', '/proj/notes')).toBe(false);
  });
  it('rejects a path that traverses out via ".."', () => {
    expect(isPathInsideRoot('/proj/notes/../etc/passwd', '/proj/notes')).toBe(false);
  });
  it('rejects ".." chains that escape root entirely', () => {
    expect(isPathInsideRoot('/proj/../etc', '/proj/notes')).toBe(false);
  });
  it('rejects relative ".." traversal', () => {
    expect(isPathInsideRoot('../../etc/passwd', '/proj/notes')).toBe(false);
  });
  it('handles "." segments transparently', () => {
    expect(isPathInsideRoot('/proj/notes/./foo.md', '/proj/notes')).toBe(true);
  });
  it('rejects an empty root', () => {
    expect(isPathInsideRoot('/anything', '')).toBe(false);
  });
  it('normalizes backslashes before comparing', () => {
    expect(isPathInsideRoot('C:\\proj\\notes\\file.md', 'C:/proj/notes')).toBe(true);
  });
});

describe('samePath (#381)', () => {
  it('reads a Windows path without case, whatever its separators', () => {
    expect(samePath('C:\\Notes\\a.md', 'c:/notes/A.md')).toBe(true);
    expect(samePath('\\\\server\\Share\\a.md', '//SERVER/share/A.md')).toBe(true);
  });

  it('reads any other path exactly, as a case-sensitive filesystem does', () => {
    expect(samePath('/home/a/Notes.md', '/home/a/notes.md')).toBe(false);
    expect(samePath('/home/a/notes.md', '/home/a/notes.md')).toBe(true);
  });

  it('tells two different Windows files apart', () => {
    expect(samePath('C:\\notes\\a.md', 'C:\\notes\\b.md')).toBe(false);
    expect(samePath('C:\\notes\\a.md', 'D:\\notes\\a.md')).toBe(false);
  });
});

/**
 * A document on a network share (#448). Every path is normalized to forward
 * slashes, so `\\server\share` arrives as `//server/share`, and the two
 * leading slashes are the host: a path that keeps one of them names a folder
 * on the current drive instead. Measured on Windows on 2026-10-01 before this
 * held: a document opened through `\\localhost\C$\...` drew its images as
 * missing, because their paths were built here.
 */
describe('a network share keeps its host (#448)', () => {
  const doc = '\\\\server\\share\\notes\\doc.md';

  it('dirname of a document on a share', () => {
    expect(dirname(doc)).toBe('//server/share/notes');
  });

  it.each([
    [['//server/share/notes', 'assets'], '//server/share/notes/assets'],
    [['//server/share/notes', 'assets', 'x.png'], '//server/share/notes/assets/x.png'],
    [['\\\\server\\share\\notes', 'assets/x.png'], '//server/share/notes/assets/x.png'],
    [['//server/share/notes/', '/assets/'], '//server/share/notes/assets'],
  ])('joinPath(%j) is %s', (parts, joined) => {
    expect(joinPath(...parts)).toBe(joined);
  });

  it('collapseDotSegments keeps the host and collapses below it', () => {
    expect(collapseDotSegments('//server/share/notes/./assets/../x.png')).toBe(
      '//server/share/notes/x.png',
    );
  });

  it('a file in the folder of a document on a share is inside it, and one on another share is not', () => {
    const root = dirname(doc);
    expect(isPathInsideRoot(joinPath(root, 'assets', 'x.png'), root)).toBe(true);
    expect(isPathInsideRoot('//server/other/notes/assets/x.png', root)).toBe(false);
    expect(isPathInsideRoot('/server/share/notes/assets/x.png', root)).toBe(false);
  });

  it('a path with one leading slash is unchanged, and so is a drive path', () => {
    expect(joinPath('/home/cata/notes', 'assets')).toBe('/home/cata/notes/assets');
    expect(joinPath('C:/Users/vasil/New folder', 'assets')).toBe(
      'C:/Users/vasil/New folder/assets',
    );
    expect(collapseDotSegments('/home/cata/../x')).toBe('/home/x');
  });
});

describe('decodePercentEscapes (#454)', () => {
  it.each([
    ['a space', 'assets/my%20diagram.png', 'assets/my diagram.png'],
    ['a hash, which decodeURI leaves escaped', 'assets/a%23b.png', 'assets/a#b.png'],
    ['a letter beyond ASCII, two bytes', 'assets/%C8%99.png', 'assets/ș.png'],
    ['an escape in lower case', 'assets/%c8%99.png', 'assets/ș.png'],
    ['a percent sign, spelled %25', 'assets/100%25.png', 'assets/100%.png'],
    ['nothing to read', 'assets/plain.png', 'assets/plain.png'],
  ])('reads %s', (_label, address, path) => {
    expect(decodePercentEscapes(address)).toBe(path);
  });

  it.each([
    ['a stray percent sign', 'assets/100%.png', 'assets/100%.png'],
    ['a percent sign before one hex digit', 'assets/a%2.png', 'assets/a%2.png'],
    ['a percent sign before letters', 'assets/50%zz%20off.png', 'assets/50%zz off.png'],
    ['a lead byte with no continuation', 'assets/%C8%20x.png', 'assets/%C8 x.png'],
    ['a continuation byte alone', 'assets/%99%20x.png', 'assets/%99 x.png'],
    ['a sequence cut short at the end', 'assets/x%E2%82', 'assets/x%E2%82'],
  ])('leaves %s as written and still reads what is beside it', (_label, address, path) => {
    expect(decodePercentEscapes(address)).toBe(path);
  });

  it.each([
    ['a slash', 'assets/a%2Fb.png'],
    ['a slash in lower case', 'assets/a%2fb.png'],
    ['a backslash', 'assets/a%5Cb.png'],
  ])('leaves an escaped %s as written, since a name cannot hold one', (_label, address) => {
    expect(decodePercentEscapes(address)).toBe(address);
  });

  it('reads the escapes beside an escaped separator', () => {
    expect(decodePercentEscapes('assets/a%2F%20b.png')).toBe('assets/a%2F b.png');
  });
});
