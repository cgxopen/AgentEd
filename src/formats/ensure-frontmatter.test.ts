import { describe, expect, it } from 'vitest';
import { getProfile } from '../profiles/index';
import { ensureFrontmatterForProfile } from './frontmatter';
import type { DocumentBundle } from './types';

function makeBundle(frontmatterRaw: string | null): DocumentBundle {
  return {
    frontmatterRaw,
    markdownBody: '# Body',
    images: [],
    archiveEntries: [],
    rootPath: 'test.md',
    meta: null,
    docFolder: null,
    layout: null,
  };
}

describe('ensureFrontmatterForProfile', () => {
  it('injects defaults for claude-skill when frontmatter missing', () => {
    const bundle = makeBundle(null);
    const result = ensureFrontmatterForProfile(bundle, getProfile('claude-skill'));
    expect(result.frontmatterRaw).toContain('name:');
    expect(result.frontmatterRaw).toContain('description:');
  });

  it('injects nested metadata.openclaw block for openclaw-skill', () => {
    const bundle = makeBundle(null);
    const result = ensureFrontmatterForProfile(bundle, getProfile('openclaw-skill'));
    expect(result.frontmatterRaw).toContain('metadata:');
    expect(result.frontmatterRaw).toContain('openclaw:');
    expect(result.frontmatterRaw).toContain('version:');
    expect(result.frontmatterRaw).toContain('skillKey:');
  });

  it('does not inject for plain profile (status: optional)', () => {
    const bundle = makeBundle(null);
    const result = ensureFrontmatterForProfile(bundle, getProfile('plain'));
    expect(result.frontmatterRaw).toBeNull();
    // No copy when nothing changes
    expect(result).toBe(bundle);
  });

  it('does not inject for llms-txt profile (status: forbidden)', () => {
    const bundle = makeBundle(null);
    const result = ensureFrontmatterForProfile(bundle, getProfile('llms-txt'));
    expect(result.frontmatterRaw).toBeNull();
  });

  it('does not overwrite existing non-empty frontmatter', () => {
    const existing = 'name: existing-skill\ndescription: do not overwrite';
    const bundle = makeBundle(existing);
    const result = ensureFrontmatterForProfile(bundle, getProfile('claude-skill'));
    expect(result.frontmatterRaw).toBe(existing);
  });
});
