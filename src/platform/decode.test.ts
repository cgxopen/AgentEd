import { describe, expect, it } from 'vitest';
import { BYTE_ORDER_MARK, decodeFileText, NotUtf8Error } from './decode';

/**
 * Issue #259 - what this application does with the bytes of a file.
 *
 * **The round-trip census cannot reach any of this**, measured rather
 * than assumed: its corpus arrives as strings Vite has already decoded,
 * so the loss this guards against happens a layer below where that
 * guard looks. This sits at the platform layer for the same reason
 * `tauri.test.ts` does.
 *
 * **Both halves are asserted and the passing half is the one that gives
 * the other its meaning.** A test that only showed a CP1250 file being
 * refused would pass just as well against a build that refuses every
 * file; the rows showing ordinary documents still decoding are what say
 * the refusal is about the bytes rather than about opening.
 */

/** The Romanian cedilla forms a legacy Windows file carries, in CP1250. */
const CP1250 = new Uint8Array([
  0x4e, 0x6f, 0x74, 0x61, 0x20, 0x64, 0x65, 0x20, 0xba, 0x65, 0x64, 0x69, 0x6e, 0xfe, 0xe3, 0x2e,
]);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('decodeFileText - a file that is not valid UTF-8 is refused (#259)', () => {
  it('throws rather than substituting a replacement character', () => {
    expect(() => decodeFileText(CP1250, '/doc/legacy.md')).toThrow(NotUtf8Error);
  });

  it('names the file it refused, so a caller can say which one', () => {
    try {
      decodeFileText(CP1250, '/doc/legacy.md');
      expect.unreachable('the decode should have thrown');
    } catch (e) {
      expect((e as NotUtf8Error).path).toBe('/doc/legacy.md');
    }
  });

  it('says so in words rather than in a code, and offers no conversion', () => {
    const message = new NotUtf8Error('/doc/legacy.md').message;
    expect(message).toContain('UTF-8');
    // The refusal explains itself and declines exactly one thing. It must
    // not offer to convert: rescuing a legacy encoding is a different
    // product from the one REQUIREMENTS describes.
    expect(message.toLowerCase()).not.toContain('convert');
    expect(message).not.toMatch(/\berror\b|\bfailed\b|[A-Z]{3,}_[A-Z]{3,}/);
  });
});

describe('decodeFileText - an ordinary document still opens (#259)', () => {
  // Without these the refusal above would be satisfied by a build that
  // refuses everything, which is the join #257 needed for the same reason.
  it.each([
    ['# Raport\n\nO linie.\n', 'plain ASCII markdown'],
    ['Diacritice: șptț ăîâ ȘȚĂÎÂ\n', 'Romanian written in UTF-8'],
    ['Ni hao, konnichiwa: 你好 こんにちは\n', 'text outside Latin'],
    ['An emoji at the end 🎉\n', 'a character outside the basic plane'],
    ['# Raport\r\n\r\nCRLF, the Windows convention.\r\n', 'CRLF line endings'],
    ['', 'an empty file'],
  ])('decodes %j - %s', (text) => {
    expect(decodeFileText(utf8(text), '/doc/notes.md')).toBe(text);
  });
});

describe('decodeFileText - a byte order mark survives the decode (#259)', () => {
  // `ignoreBOM` is what makes the mark reachable by the layer that carries
  // it. A decoder without that option consumes it here, three bytes gone
  // before any AgentEd code runs - which is what the build did before.
  it('keeps the mark in the text rather than consuming it', () => {
    const withMark = `${BYTE_ORDER_MARK}# Raport\n`;
    expect(decodeFileText(utf8(withMark), '/doc/notes.md')).toBe(withMark);
  });

  it('adds no mark to a file that had none', () => {
    expect(decodeFileText(utf8('# Raport\n'), '/doc/notes.md')).toBe('# Raport\n');
  });
});
