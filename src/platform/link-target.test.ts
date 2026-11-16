/**
 * The resolver of relative links (#727), one row per case of the table on the
 * issue: the cases of the step zero from a document on a local Windows drive,
 * and the rows it adds - a drive root, letter case, a document on a share, a
 * document with no file, a POSIX path and the path the web build names a
 * document by. No row may yield a path on another machine from a local
 * document.
 */
import { describe, expect, it } from 'vitest';
import { type LinkTarget, resolveLinkTarget } from './link-target';

const WIN = 'C:/docs/index.md';
const WIN_BACKSLASH = 'C:\\docs\\index.md';
const POSIX = '/home/u/docs/index.md';
const SHARE = '//host/share/docs/index.md';
const WEB = 'docs/index.md';

const file = (path: string, markdown = true): LinkTarget => ({ kind: 'file', path, markdown });
const refused = (reason: string): LinkTarget => ({ kind: 'refused', reason }) as LinkTarget;

describe('the resolver of relative links (#727), from a local Windows drive', () => {
  it.each<[string, LinkTarget]>([
    ['./a.md', file('C:/docs/a.md')],
    ['a.md', file('C:/docs/a.md')],
    ['../b/c.md', file('C:/b/c.md')],
    ['a%20b.md', file('C:/docs/a b.md')],
    ['a.md#h', file('C:/docs/a.md')],
    ['#h', refused('anchor-only')],
    ['a.md?x=1', file('C:/docs/a.md')],
    ['/a.md', refused('rooted')],
    ['sub/', refused('folder')],
    ['missing.md', file('C:/docs/missing.md')],
    ['x.pdf', file('C:/docs/x.pdf', false)],
    ['x.svg', file('C:/docs/x.svg', false)],
    [String.raw`\\host\x.pdf`, refused('not-relative')],
    ['//host/x.pdf', refused('not-relative')],
    [String.raw`/\host/x.pdf`, refused('not-relative')],
    ['C:/x.pdf', refused('not-relative')],
    ['file:///x.pdf', refused('not-relative')],
    ['https://example.com/a.md', refused('not-relative')],
  ])('%s', (address, expected) => {
    expect(resolveLinkTarget(WIN, address)).toEqual(expected);
  });
});

describe('the rows the resolver adds (#727)', () => {
  it.each<[string, string | null, string, LinkTarget]>([
    ['a leading backslash is a rooted link', WIN, String.raw`\a.md`, refused('rooted')],
    ['.. above the root of the drive', WIN, '../../x.md', refused('above-root')],
    [
      '.. spelled with backslashes climbs too, and stops at the drive',
      WIN,
      String.raw`..\..\x.md`,
      refused('above-root'),
    ],
    ['.. to the root of the drive itself', WIN, '..', refused('folder')],
    [
      'an empty segment cannot build a share from a local document',
      WIN,
      'sub/..//..//host/x.md',
      file('C:/host/x.md'),
    ],
    ['a document path with backslashes', WIN_BACKSLASH, '../b/c.md', file('C:/b/c.md')],
    [
      'letter case is kept, and an upper case extension is markdown',
      WIN,
      'NOTES.MD',
      file('C:/docs/NOTES.MD'),
    ],
    ['an escaped separator stays as written', WIN, 'a%2Fb.md', file('C:/docs/a%2Fb.md')],
    ['a document on a share stays on that share', SHARE, './a.md', file('//host/share/docs/a.md')],
    [
      '.. above the share is refused, not another share',
      SHARE,
      '../../x.md',
      refused('above-root'),
    ],
    [
      'a share named by its device path stays on that share',
      String.raw`\\?\UNC\host\share\docs\index.md`,
      './a.md',
      file('//?/UNC/host/share/docs/a.md'),
    ],
    [
      '.. above a share named by its device path is refused, not another host',
      String.raw`\\?\UNC\host\share\docs\index.md`,
      '../../other/x.md',
      refused('above-root'),
    ],
    [
      'the same with the dot device prefix',
      String.raw`\\.\UNC\host\share\index.md`,
      '../x.md',
      refused('above-root'),
    ],
    [
      'a drive named by its device path keeps the drive as its root',
      String.raw`\\?\C:\docs\index.md`,
      '../../x.md',
      refused('above-root'),
    ],
    [
      'a drive named by its device path resolves below it',
      String.raw`\\?\C:\docs\index.md`,
      '../b/c.md',
      file('//?/C:/b/c.md'),
    ],
    ['a document with no file', null, 'a.md', refused('no-document')],
    ['an anchor alone needs no file', null, '#h', refused('anchor-only')],
    ['a POSIX document', POSIX, '../../../x.md', file('/x.md')],
    ['.. above / on POSIX', POSIX, '../../../../x.md', refused('above-root')],
    [
      'the web build names a document by its place in the granted folder',
      WEB,
      '../x.md',
      file('x.md'),
    ],
    ['.. above the granted folder on the web build', WEB, '../../x.md', refused('above-root')],
  ])('%s', (_name, document, address, expected) => {
    expect(resolveLinkTarget(document, address)).toEqual(expected);
  });

  it('no address from a local document yields a path on another machine', () => {
    const tries = [
      String.raw`\\host\x.md`,
      '//host/x.md',
      String.raw`/\host/x.md`,
      'a/../../..//host/x.md',
      String.raw`..\..\..\\host\x.md`,
      'sub/%2F%2Fhost/x.md',
      './/host/x.md',
    ];
    for (const document of [WIN, WIN_BACKSLASH, POSIX]) {
      for (const address of tries) {
        const target = resolveLinkTarget(document, address);
        if (target.kind === 'file')
          expect(target.path.startsWith('//'), `${document} + ${address}`).toBe(false);
      }
    }
  });
});
