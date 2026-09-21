/**
 * The comparison behind R-C14, on its own: what the save flow is told
 * about the file it is about to write over.
 *
 * This layer only reports. That the three answers turn into a dialog
 * with three buttons is `src/app`'s business and is covered at the
 * save-flow level in `src/app/external-change.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { detectExternalChange } from './external-change';

function ioReturning(snapshot: FileSnapshot): PlatformIO & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    // Desktop-shaped: every path carries a directory (#46).
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    readSnapshot: async (path: string) => {
      reads.push(path);
      return snapshot;
    },
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async () => 'absent' as const,
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

describe('detectExternalChange', () => {
  it('reports no change when the file still holds what AgentEd put there', async () => {
    const io = ioReturning({ kind: 'file', text: '# Notes\n' });
    expect(await detectExternalChange('/doc/notes.md', '# Notes\n', io)).toEqual({ kind: 'none' });
  });

  it('reports a change when the text on disk is a different text', async () => {
    const io = ioReturning({ kind: 'file', text: '# Notes, edited elsewhere\n' });
    expect(await detectExternalChange('/doc/notes.md', '# Notes\n', io)).toEqual({
      kind: 'changed',
    });
  });

  it('does not read the disk at all when nothing is known about the path', async () => {
    const io = ioReturning({ kind: 'file', text: 'whatever' });
    expect(await detectExternalChange('/doc/new.md', null, io)).toEqual({ kind: 'none' });
    expect(io.reads).toEqual([]);
  });

  it('treats a file that is no longer there as nothing to overwrite', async () => {
    const io = ioReturning({ kind: 'absent' });
    expect(await detectExternalChange('/doc/notes.md', '# Notes\n', io)).toEqual({ kind: 'none' });
  });

  it('never turns "could not read it" into "nothing changed"', async () => {
    const cause = new Error('EACCES: permission denied');
    const io = ioReturning({ kind: 'unreadable', cause });
    expect(await detectExternalChange('/doc/notes.md', '# Notes\n', io)).toEqual({
      kind: 'unverifiable',
      cause,
    });
  });

  it('catches a change that leaves the file the same length', async () => {
    // The case a timestamp comparison would also have to catch, and the
    // reason the comparison is the text rather than the metadata.
    const io = ioReturning({ kind: 'file', text: '# Notes\n' });
    expect(await detectExternalChange('/doc/notes.md', '# NOTES\n', io)).toEqual({
      kind: 'changed',
    });
  });
});
