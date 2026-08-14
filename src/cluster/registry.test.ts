import { describe, expect, it } from 'vitest';
import { getCanonicalFilenames, getKindForFilename } from './registry';

describe('getKindForFilename — canonical matches', () => {
  it('AGENTS.md → agents-md', () => {
    expect(getKindForFilename('AGENTS.md')).toBe('agents-md');
  });

  it('CLAUDE.md → claude-md', () => {
    expect(getKindForFilename('CLAUDE.md')).toBe('claude-md');
  });

  it('.hermes.md → hermes-context', () => {
    expect(getKindForFilename('.hermes.md')).toBe('hermes-context');
  });

  it('HERMES.md → hermes-context (uppercase variant)', () => {
    expect(getKindForFilename('HERMES.md')).toBe('hermes-context');
  });

  it('.cursorrules → cursor-rules', () => {
    expect(getKindForFilename('.cursorrules')).toBe('cursor-rules');
  });

  it('SOUL.md → hermes-soul', () => {
    expect(getKindForFilename('SOUL.md')).toBe('hermes-soul');
  });
});

describe('getKindForFilename — case sensitivity (canonical entries are case-sensitive)', () => {
  it('agents.md (lowercase) does NOT match AGENTS.md', () => {
    expect(getKindForFilename('agents.md')).toBeNull();
  });

  it('claude.md (lowercase) does NOT match CLAUDE.md', () => {
    expect(getKindForFilename('claude.md')).toBeNull();
  });

  it('Cursorrules (no leading dot) does NOT match .cursorrules', () => {
    expect(getKindForFilename('Cursorrules')).toBeNull();
  });
});

describe('getKindForFilename — non-context filenames', () => {
  it('README.md → null', () => {
    expect(getKindForFilename('README.md')).toBeNull();
  });

  it('SKILL.md → null (skills are out of scope per ADR-031 §D1)', () => {
    expect(getKindForFilename('SKILL.md')).toBeNull();
  });

  it('llms.txt → null (single-doc per site, not cluster)', () => {
    expect(getKindForFilename('llms.txt')).toBeNull();
  });

  it('empty string → null', () => {
    expect(getKindForFilename('')).toBeNull();
  });
});

describe('getCanonicalFilenames', () => {
  it('returns the full canonical list', () => {
    const list = getCanonicalFilenames();
    expect(list).toContain('AGENTS.md');
    expect(list).toContain('CLAUDE.md');
    expect(list).toContain('.hermes.md');
    expect(list).toContain('HERMES.md');
    expect(list).toContain('.cursorrules');
    expect(list).toContain('SOUL.md');
  });

  it('returns a fresh array (mutation isolated from registry)', () => {
    const a = getCanonicalFilenames();
    a.push('SHOULDN_NOT_LEAK.md');
    const b = getCanonicalFilenames();
    expect(b).not.toContain('SHOULDN_NOT_LEAK.md');
  });

  it('size matches the documented count (6 entries at v0.2.x)', () => {
    expect(getCanonicalFilenames()).toHaveLength(6);
  });
});
