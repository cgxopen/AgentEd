import { describe, expect, it, vi } from 'vitest';

// The plugin boundary, mocked so the module can be imported at all. None of
// it is reached by the method under test: `canWriteCompanions` is a string
// operation over the document path and touches no plugin. The mocks exist
// because `tauri.ts` imports these at module scope.
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { TauriIO } from './tauri';

/**
 * Issue #201 - what the desktop predicate actually answers, held here so it
 * stops being rediscovered.
 *
 * `canWriteCompanions` reads as a capability check and on this platform it is
 * a path-shape check: `dirname(path).length > 0 && dirname(path) !== '/'`,
 * with `dirname` running `normalize` first, so every backslash is a forward
 * slash before the comparison. The consequence is the thing worth pinning:
 * **no path a Windows picker can return reaches the false branch.** A drive
 * root does not, because its parent is `C:` rather than the single slash the
 * check names. So on the only desktop target that ships, this answers `true`
 * for every document, and the `no-folder-access` value that `shouldShowSidebar`
 * derives from it is unreachable there.
 *
 * That fact went unrecorded through three instances - #182, #188 and #189 -
 * and was the reason a rename kept being proposed for a branch that does not
 * run. It is carried by something that executes rather than by a name, which
 * is the whole of the owner decision of 2026-09-08.
 *
 * **Both halves are asserted and neither means anything alone.** A table of
 * Windows paths answering `true` would pass equally against an implementation
 * that returns `true` unconditionally - which is indistinguishable from this
 * one on Windows input, so that half proves nothing by itself. The two false
 * rows are what show the function is being read: they need a POSIX filesystem
 * root or a bare name, and neither is a shape this platform produces.
 *
 * The real `TauriIO` rather than a double, deliberately. A double asserting a
 * constant would only restate the constant it was given.
 */
describe('TauriIO.canWriteCompanions - the shape of the desktop answer (#201)', () => {
  const io = new TauriIO();

  // Every shape a Windows picker returns. All true, and that is the point:
  // the predicate carries no information on the shipped desktop target.
  it.each([
    ['C:\\Users\\vasil\\Documents\\notes.md', 'an ordinary Windows document'],
    ['C:\\notes.md', 'a document at a drive root'],
    ['D:\\notes.md', 'a document at a second drive root'],
    ['\\\\server\\share\\notes.md', 'a UNC share'],
    ['C:\\Users\\vasil\\OneDrive - Corp\\a b\\notes.md', 'spaces and a dash in the folders'],
    ['/home/cata/notes.md', 'a POSIX path with a parent'],
  ])('%s answers true - %s', async (path) => {
    expect(await io.canWriteCompanions(path)).toBe(true);
  });

  // The only two false answers there are. Neither is reachable from a Tauri
  // picker on Windows, which is what makes the branch above unreachable -
  // and asserting them is what stops the rows above from passing against an
  // implementation that never reads its argument.
  it.each([
    ['/notes.md', 'the POSIX filesystem root, where mkdir would be meaningless'],
    ['notes.md', 'a bare name, which has no parent to put assets beside'],
  ])('%s answers false - %s', async (path) => {
    expect(await io.canWriteCompanions(path)).toBe(false);
  });
});

/**
 * What the shell is handed for a file in the files panel (#448).
 *
 * This layer holds every path with forward slashes, and the Windows shell
 * reads a drive path spelled that way but not a network share: measured on
 * Windows on 2026-10-01, `//localhost/C$/.../x-dots-1.png` answered *Windows
 * cannot find* for a file that was there, while the editor drew the same
 * image through the filesystem. A path in either Windows shape is handed over
 * with backslashes; a POSIX path and a web address are handed as they are.
 */
describe('TauriIO.openWithSystem - the spelling the shell is handed (#448)', () => {
  it.each([
    [
      '//localhost/C$/Users/vasil/Documents/New folder/assets/x-dots-1.png',
      '\\\\localhost\\C$\\Users\\vasil\\Documents\\New folder\\assets\\x-dots-1.png',
    ],
    [
      'C:/Users/vasil/Documents/New folder/assets/x.png',
      'C:\\Users\\vasil\\Documents\\New folder\\assets\\x.png',
    ],
    ['/home/cata/My Notes/assets/x.png', '/home/cata/My Notes/assets/x.png'],
    ['https://example.com/a', 'https://example.com/a'],
    ['mailto:hi@example.com', 'mailto:hi@example.com'],
  ])('%s is handed as %s', async (held, handed) => {
    const { open } = await import('@tauri-apps/plugin-shell');
    vi.mocked(open).mockClear();
    await new TauriIO().openWithSystem(held);
    expect(open).toHaveBeenCalledWith(handed);
  });
});
