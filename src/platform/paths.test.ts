import { describe, expect, it } from 'vitest';
import {
  basename,
  collapseDotSegments,
  dirname,
  isPathInsideRoot,
  joinPath,
  normalize,
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
    expect(basename('C:\\Users\\cata\\doc.md')).toBe('doc.md');
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
    expect(dirname('C:\\Users\\cata\\doc.md')).toBe('C:/Users/cata');
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
