import { describe, expect, it } from 'vitest';
import { sha256 } from './hash';

describe('sha256', () => {
  it('produces known hash for empty string', async () => {
    expect(await sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('produces known hash for "abc"', async () => {
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic', async () => {
    const h1 = await sha256('hello world');
    const h2 = await sha256('hello world');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});
