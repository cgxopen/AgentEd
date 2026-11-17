/**
 * #731 - the two halves of the hand-over to the system, joined. The list of
 * ten kinds the page refuses outside of is the extension group of the scope
 * the shell enforces, and the path a link hands over is one the cases file
 * admits, which `src-tauri/src/shell_scope.rs` matches against the scope as
 * the plugin compiles it.
 */
import { describe, expect, it } from 'vitest';
import cases from '../../src-tauri/shell-open-cases.json';
import config from '../../src-tauri/tauri.conf.json';
import { resolveLinkTarget } from '../platform/link-target';
import { isSystemOpenPath, SYSTEM_OPEN_EXTENSIONS, shellPath } from '../platform/paths';

describe('the ten kinds are the extension group of the shell open scope (#731)', () => {
  it('every extension group of the scope is the list, in its order', () => {
    const groups = [...config.plugins.shell.open.matchAll(/\(\?i:([a-z|]+)\)/g)].map((m) =>
      m[1].split('|'),
    );
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group).toEqual([...SYSTEM_OPEN_EXTENSIONS]);
  });

  it.each([
    ['x.pdf', true],
    ['X.PDF', true],
    ['x.yml', true],
    ['x.svg', false],
    ['x.html', false],
    ['x.pdf.exe', false],
    ['x.md', false],
    ['pdf', false],
  ])('%s is one of them: %s', (name, expected) => {
    expect(isSystemOpenPath(`/d/${name}`)).toBe(expected);
  });
});

const LOCAL_DOCUMENTS = [
  'C:/Users/vasil/Documents/notes/docs/index.md',
  '/home/cata/notes/docs/index.md',
  '/Users/cata/notes/docs/index.md',
];
const ADDRESSES = [
  '../x.pdf',
  '../../x.pdf',
  'sub/../x.txt',
  '%2e%2e/x.png',
  './sub/x.png',
  'x.yml',
];

describe('what a link from a local document hands to the shell (#731)', () => {
  it.each(LOCAL_DOCUMENTS)('from %s: an admitted path, never one on another machine', (doc) => {
    for (const address of ADDRESSES) {
      const target = resolveLinkTarget(doc, address);
      expect(target.kind, address).toBe('file');
      if (target.kind !== 'file') continue;
      const handed = shellPath(target.path);
      expect(cases.admittedPaths, `${doc} ${address}`).toContain(handed);
      expect(handed.startsWith('\\\\') || handed.startsWith('//'), handed).toBe(false);
    }
  });

  it('a document on a share hands paths on that share, which the cases admit', () => {
    const target = resolveLinkTarget('//server/share/notes/docs/index.md', '../x.pdf');
    expect(target.kind === 'file' && shellPath(target.path)).toBe(
      '\\\\server\\share\\notes\\x.pdf',
    );
    expect(cases.admittedPaths).toContain('\\\\server\\share\\notes\\x.pdf');
  });

  it('a kind outside the ten, from any document, is refused by the cases', () => {
    for (const doc of LOCAL_DOCUMENTS) {
      const target = resolveLinkTarget(doc, 'x.svg');
      if (target.kind !== 'file') throw new Error('x.svg resolves');
      expect(cases.refused).toContain(shellPath(target.path));
    }
  });
});
