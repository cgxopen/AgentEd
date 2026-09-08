import { describe, expect, it } from 'vitest';
import { BYTE_ORDER_MARK } from '../platform/decode';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import { applyByteOrderMark, hasByteOrderMark, stripByteOrderMark } from './byte-order-mark';
import { loadMarkdown, saveMarkdown } from './plain';

/**
 * Issue #259 - a mark the file had is put back, and one it did not have
 * is never added.
 *
 * The whole path rather than the helpers alone, because the helpers
 * cannot see either end of it: the mark is read in `parseMarkdown` and
 * re-applied in `saveMarkdown`, which is the structure #79 built for
 * line terminators and the reason this is carried rather than recorded
 * as a nineteenth R-C2 exception.
 */

const P = '/doc/notes.md';

function recordingIO(disk: Map<string, string>): PlatformIO {
  return {
    supportsMultiFile: false,
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async (p: string) => {
      const t = disk.get(p);
      if (t === undefined) throw new Error(`no such file: ${p}`);
      return t;
    },
    saveFile: async (p: string, c: string) => {
      disk.set(p, c);
    },
    readSnapshot: async (p: string): Promise<FileSnapshot> => {
      const t = disk.get(p);
      return t === undefined ? { kind: 'absent' } : { kind: 'file', text: t };
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

/** Open and save with no edit, through the layer that reads and writes files. */
async function openAndSave(text: string): Promise<string> {
  const disk = new Map([[P, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(P, io);
  const result = await saveMarkdown(loaded.bundle, io);
  return result.writtenText;
}

describe('a byte order mark is a property of the file (#259)', () => {
  it('a file that had one gets it back, byte for byte', async () => {
    const source = `${BYTE_ORDER_MARK}# Raport\n\nO linie.\n`;
    expect(await openAndSave(source)).toBe(source);
  });

  // The half that gives the half above its meaning: a build that always
  // wrote a mark would satisfy the first assertion and destroy every file
  // that never had one.
  it('a file that had none does not gain one', async () => {
    const source = '# Raport\n\nO linie.\n';
    const saved = await openAndSave(source);
    expect(saved).toBe(source);
    expect(hasByteOrderMark(saved)).toBe(false);
  });

  it('the mark rides beside the line conventions rather than fighting them', async () => {
    const source = `${BYTE_ORDER_MARK}# Raport\r\n\r\nO linie.\r\n`;
    expect(await openAndSave(source)).toBe(source);
  });

  it('a metadata block behind a mark is still recognised', async () => {
    const source = `${BYTE_ORDER_MARK}---\ntitle: Raport\n---\n\nO linie.\n`;
    const loaded = await loadMarkdown(P, recordingIO(new Map([[P, source]])));
    expect(loaded.bundle.frontmatterRaw).toBe('title: Raport');
    expect(loaded.bundle.byteOrderMark).toBe(true);
    expect(await openAndSave(source)).toBe(source);
  });
});

describe('the helpers, on their own', () => {
  it('reads, removes and restores one mark', () => {
    expect(hasByteOrderMark(`${BYTE_ORDER_MARK}x`)).toBe(true);
    expect(hasByteOrderMark('x')).toBe(false);
    expect(stripByteOrderMark(`${BYTE_ORDER_MARK}x`)).toBe('x');
    expect(applyByteOrderMark('x', true)).toBe(`${BYTE_ORDER_MARK}x`);
    expect(applyByteOrderMark('x', false)).toBe('x');
  });

  it('removes only the first, because the second is content', () => {
    // U+FEFF after the mark is a zero-width no-break space the document
    // contains; dropping it would be the loss this module exists to stop.
    expect(stripByteOrderMark(`${BYTE_ORDER_MARK}${BYTE_ORDER_MARK}x`)).toBe(`${BYTE_ORDER_MARK}x`);
  });

  it('applies idempotently, so a second save cannot double the mark', () => {
    expect(applyByteOrderMark(applyByteOrderMark('x', true), true)).toBe(`${BYTE_ORDER_MARK}x`);
  });
});
