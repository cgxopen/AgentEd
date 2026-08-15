import { describe, expect, it } from 'vitest';
import {
  buildImageName,
  documentBaseName,
  extensionOf,
  isGenericName,
  nextDocumentIndex,
  resolveCollision,
  sanitizeBaseName,
} from './image-names';

const NOTHING_TAKEN: ReadonlySet<string> = new Set();

describe('sanitizeBaseName', () => {
  it('folds diacritics to ASCII', () => {
    expect(sanitizeBaseName('Diagramă finală')).toBe('Diagrama-finala');
  });

  it('spells out letters that do not decompose', () => {
    expect(sanitizeBaseName('Größenübersicht')).toBe('Grossenubersicht');
    expect(sanitizeBaseName('Ærø')).toBe('AEro');
  });

  it('turns spaces into hyphens', () => {
    expect(sanitizeBaseName('quarterly report v2')).toBe('quarterly-report-v2');
  });

  it('keeps the name readable rather than transliterating it away', () => {
    expect(sanitizeBaseName('Raport lunar')).toBe('Raport-lunar');
  });

  it('drops characters Windows refuses in a file name', () => {
    expect(sanitizeBaseName('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('collapses runs of separators and trims the ends', () => {
    expect(sanitizeBaseName('  --  spaced   out --  ')).toBe('spaced-out');
  });

  it('never returns an empty name', () => {
    expect(sanitizeBaseName('***')).toBe('image');
    expect(sanitizeBaseName('')).toBe('image');
  });

  it('escapes a Windows device name', () => {
    expect(sanitizeBaseName('con')).toBe('con-image');
    expect(sanitizeBaseName('COM1')).toBe('COM1-image');
  });

  it('bounds the length and leaves no trailing separator', () => {
    const long = sanitizeBaseName(`${'a'.repeat(70)} tail`);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith('-')).toBe(false);
  });
});

describe('extensionOf', () => {
  it('lowercases the extension', () => {
    expect(extensionOf('Photo.PNG')).toBe('png');
  });

  it('reads the last extension only', () => {
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('returns nothing when there is no extension', () => {
    expect(extensionOf('plain')).toBe('');
  });
});

describe('isGenericName', () => {
  it('recognises the placeholders clipboards hand out', () => {
    expect(isGenericName('image.png')).toBe(true);
    expect(isGenericName('image (1).png')).toBe(true);
    expect(isGenericName('screenshot 2026-08-15.png')).toBe(true);
    expect(isGenericName('')).toBe(true);
  });

  it('leaves a real name alone', () => {
    expect(isGenericName('diagram.png')).toBe(false);
    expect(isGenericName('Raport lunar.png')).toBe(false);
  });
});

describe('documentBaseName', () => {
  it('derives a lowercase base from the document name', () => {
    expect(documentBaseName('Raport lunar.md')).toBe('raport-lunar');
  });

  it('falls back when the document has no name yet', () => {
    expect(documentBaseName(null)).toBe('image');
  });
});

describe('nextDocumentIndex', () => {
  it('starts at 1 in an empty folder', () => {
    expect(nextDocumentIndex('raport-lunar', NOTHING_TAKEN)).toBe(1);
  });

  it('continues past the highest index already there', () => {
    const taken = new Set(['raport-lunar-01.png', 'raport-lunar-02.png', 'raport-lunar-07.png']);
    expect(nextDocumentIndex('raport-lunar', taken)).toBe(8);
  });

  it('counts indexes whatever the extension', () => {
    expect(nextDocumentIndex('raport', new Set(['raport-03.jpg']))).toBe(4);
  });

  it('ignores names belonging to another document', () => {
    expect(nextDocumentIndex('raport', new Set(['alt-raport-09.png', 'raport-x.png']))).toBe(1);
  });

  it('treats a base with regex characters literally', () => {
    expect(nextDocumentIndex('a.b(c)', new Set(['a.b(c)-04.png']))).toBe(5);
  });
});

describe('resolveCollision', () => {
  it('leaves a free name alone', () => {
    expect(resolveCollision('diagram.png', NOTHING_TAKEN)).toBe('diagram.png');
  });

  it('suffixes a taken name with a number', () => {
    expect(resolveCollision('diagram.png', new Set(['diagram.png']))).toBe('diagram-2.png');
  });

  it('keeps counting past the suffixes already used', () => {
    const taken = new Set(['diagram.png', 'diagram-2.png', 'diagram-3.png']);
    expect(resolveCollision('diagram.png', taken)).toBe('diagram-4.png');
  });

  it('compares names the way Windows does, ignoring case', () => {
    expect(resolveCollision('Diagram.png', new Set(['diagram.png']))).toBe('Diagram-2.png');
  });

  it('gives up rather than overwrite when a thousand variants are taken', () => {
    const taken = new Set(['diagram.png']);
    for (let i = 2; i < 1002; i++) taken.add(`diagram-${i}.png`);
    expect(resolveCollision('diagram.png', taken)).toBeNull();
  });
});

describe('buildImageName', () => {
  it('names a pasted screenshot after the document (the R-C5 example)', () => {
    expect(
      buildImageName({
        sourceName: 'image.png',
        documentName: 'Raport lunar.md',
        taken: NOTHING_TAKEN,
        origin: 'clipboard',
      }),
    ).toBe('raport-lunar-01.png');
  });

  it('continues the document sequence on the next paste', () => {
    expect(
      buildImageName({
        sourceName: 'image.png',
        documentName: 'Raport lunar.md',
        taken: new Set(['raport-lunar-01.png']),
        origin: 'clipboard',
      }),
    ).toBe('raport-lunar-02.png');
  });

  it('keeps a dropped file name, sanitized', () => {
    expect(
      buildImageName({
        sourceName: 'Diagramă finală.PNG',
        documentName: 'notes.md',
        taken: NOTHING_TAKEN,
        origin: 'file',
      }),
    ).toBe('Diagrama-finala.png');
  });

  it('keeps a real name even when it arrives through the clipboard', () => {
    expect(
      buildImageName({
        sourceName: 'diagram.png',
        documentName: 'notes.md',
        taken: NOTHING_TAKEN,
        origin: 'clipboard',
      }),
    ).toBe('diagram.png');
  });

  it('never overwrites a file already in the folder', () => {
    expect(
      buildImageName({
        sourceName: 'diagram.png',
        documentName: 'notes.md',
        taken: new Set(['diagram.png']),
        origin: 'file',
      }),
    ).toBe('diagram-2.png');
  });

  it('assumes png when the source carries no extension', () => {
    expect(
      buildImageName({
        sourceName: '',
        documentName: 'notes.md',
        taken: NOTHING_TAKEN,
        origin: 'clipboard',
      }),
    ).toBe('notes-01.png');
  });

  it('falls back to a generic base while the document is unsaved', () => {
    expect(
      buildImageName({
        sourceName: 'image.png',
        documentName: null,
        taken: NOTHING_TAKEN,
        origin: 'clipboard',
      }),
    ).toBe('image-01.png');
  });

  it('produces no hash, timestamp or random suffix', () => {
    const name = buildImageName({
      sourceName: 'image.png',
      documentName: 'Notes.md',
      taken: NOTHING_TAKEN,
      origin: 'clipboard',
    });
    expect(name).toBe('notes-01.png');
    expect(name).not.toMatch(/\d{10,}/);
  });
});
