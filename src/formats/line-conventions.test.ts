/**
 * The two pure functions behind #79, on the strings alone. The
 * behaviour a user meets is pinned one layer up, through the real save
 * assembly, in `src/app/save-line-conventions.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  applyLineConventions,
  DEFAULT_LINE_CONVENTIONS,
  detectLineConventions,
} from './line-conventions';

describe('detectLineConventions', () => {
  it.each([
    ['a CRLF document', '# T\r\n\r\nA line.\r\n', '\r\n', true],
    ['an LF document', '# T\n\nA line.\n', '\n', true],
    ['a CRLF document with no final newline', '# T\r\n\r\nA line.', '\r\n', false],
    ['an LF document with no final newline', '# T\n\nA line.', '\n', false],
    ['a single line with no terminator at all', '# T', '\n', false],
    ['an empty file', '', '\n', false],
  ])('reads %s', (_label, text, terminator, finalNewline) => {
    expect(detectLineConventions(text)).toEqual({
      lineTerminator: terminator,
      finalNewline,
    });
  });

  it('lets the first terminator decide a mixed file (R-C2 known exception)', () => {
    expect(detectLineConventions('# T\r\n\r\nFirst.\nSecond.\r\n').lineTerminator).toBe('\r\n');
    expect(detectLineConventions('# T\n\nFirst.\r\nSecond.\n').lineTerminator).toBe('\n');
  });

  it('reads a lone-CR file as LF — that convention is not detected', () => {
    // Classic Mac line endings. The file carries no `\r\n`, so nothing
    // claims it is CRLF, and it is written with `\n`.
    expect(detectLineConventions('# T\r\rA line.\r')).toEqual({
      lineTerminator: '\n',
      finalNewline: false,
    });
  });
});

describe('applyLineConventions', () => {
  const CRLF = { lineTerminator: '\r\n', finalNewline: true } as const;
  const LF_NO_FINAL = { lineTerminator: '\n', finalNewline: false } as const;

  it('imposes CRLF on text the serializer emitted as LF', () => {
    expect(applyLineConventions('# T\n\nA line.', CRLF)).toBe('# T\r\n\r\nA line.\r\n');
  });

  it('never doubles a `\\r` that is already there', () => {
    // The frontmatter of a CRLF document still carries `\r\n` inside the
    // block; a naive "append `\r` to every `\n`" would write `\r\r\n`.
    const assembled = '---\ntitle: T\r\ndate: 2026-08-22\n---\n# T\n';
    const written = applyLineConventions(assembled, CRLF);
    expect(written).toBe('---\r\ntitle: T\r\ndate: 2026-08-22\r\n---\r\n# T\r\n');
    expect(written).not.toContain('\r\r');
  });

  it('is idempotent — applying twice changes nothing', () => {
    const once = applyLineConventions('# T\n\nA line.', CRLF);
    expect(applyLineConventions(once, CRLF)).toBe(once);
  });

  it('removes the final newline when the file had none', () => {
    expect(applyLineConventions('# T\n\nA line.\n', LF_NO_FINAL)).toBe('# T\n\nA line.');
  });

  it('adds exactly one final newline, never the run the text ended with', () => {
    expect(applyLineConventions('# T\n\n\n\n', DEFAULT_LINE_CONVENTIONS)).toBe('# T\n');
  });

  it('writes an empty document as an empty file, not as a newline', () => {
    expect(applyLineConventions('', DEFAULT_LINE_CONVENTIONS)).toBe('');
    expect(applyLineConventions('\n\n', DEFAULT_LINE_CONVENTIONS)).toBe('');
  });

  it('converts CRLF back to LF for an LF document', () => {
    expect(applyLineConventions('# T\r\n\r\nA line.\r\n', DEFAULT_LINE_CONVENTIONS)).toBe(
      '# T\n\nA line.\n',
    );
  });
});
