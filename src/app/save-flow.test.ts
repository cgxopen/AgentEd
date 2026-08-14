/**
 * Integration coverage for the persistBundle "detect-then-inject"
 * reorder (M4.3 of ADR-030). Composes the two pure pieces — profile
 * detection and frontmatter injection — exactly as `persistBundle`
 * does, with a stubbed PlatformIO so the test stays in node.
 */
import { describe, expect, it } from 'vitest';
import { ensureFrontmatterForProfile } from '../formats/frontmatter';
import type { DocumentBundle } from '../formats/types';
import type { PlatformIO } from '../platform/types';
import { detectProfileForBundle } from '../profiles/detect-bundle';
import { getProfile } from '../profiles/index';

function stubIO(): PlatformIO {
  return {
    supportsMultiFile: true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async () => '',
    saveFile: async () => {},
    saveFileAs: async () => null,
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    exists: async () => false,
    listDir: async () => [],
    mkdir: async () => {},
    remove: async () => {},
    openWithSystem: async () => {},
  };
}

function bundleAt(rootPath: string, frontmatterRaw: string | null): DocumentBundle {
  return {
    frontmatterRaw,
    markdownBody: '# Hello\n\nSome plain content.\n',
    images: [],
    archiveEntries: [],
    rootPath,
    meta: null,
    docFolder: rootPath.toLowerCase().endsWith('/skill.md')
      ? rootPath.replace(/\/[^/]+$/, '')
      : null,
    layout: rootPath.toLowerCase().endsWith('/skill.md') ? 'parent-as-folder' : null,
  };
}

describe('Save As → SKILL.md flow', () => {
  it('detects claude-skill on a fresh SKILL.md without frontmatter', async () => {
    const bundle = bundleAt('/tmp/my-skill/SKILL.md', null);
    const profileId = await detectProfileForBundle(bundle, stubIO());
    expect(profileId).toBe('claude-skill');
  });

  it('injects name + description defaults on a fresh SKILL.md at first save', async () => {
    const bundle = bundleAt('/tmp/my-skill/SKILL.md', null);
    const profileId = await detectProfileForBundle(bundle, stubIO());
    const profile = getProfile(profileId);
    const enriched = ensureFrontmatterForProfile(bundle, profile);
    expect(enriched.frontmatterRaw).not.toBeNull();
    expect(enriched.frontmatterRaw).toMatch(/name:/);
    expect(enriched.frontmatterRaw).toMatch(/description:/);
  });

  it('falls back to agentskills-v1 when SKILL.md already has name + description without Claude markers', async () => {
    const fm = 'name: my-skill\ndescription: does things';
    const bundle = bundleAt('/tmp/my-skill/SKILL.md', fm);
    const profileId = await detectProfileForBundle(bundle, stubIO());
    expect(profileId).toBe('agentskills-v1');
  });

  it('detects openclaw-skill when frontmatter has metadata.openclaw', async () => {
    const fm = 'name: my-skill\nmetadata:\n  openclaw:\n    version: "1.0.0"';
    const bundle = bundleAt('/tmp/my-skill/SKILL.md', fm);
    const profileId = await detectProfileForBundle(bundle, stubIO());
    expect(profileId).toBe('openclaw-skill');
  });

  it('does not inject for plain documents (status: optional)', async () => {
    const bundle = bundleAt('/tmp/notes.md', null);
    const profileId = await detectProfileForBundle(bundle, stubIO());
    expect(profileId).toBe('plain');
    const profile = getProfile(profileId);
    const enriched = ensureFrontmatterForProfile(bundle, profile);
    expect(enriched.frontmatterRaw).toBeNull();
  });

  it('keeps existing frontmatter intact on subsequent saves', async () => {
    const fm = 'name: my-skill\ndescription: already here';
    const bundle = bundleAt('/tmp/my-skill/SKILL.md', fm);
    const profileId = await detectProfileForBundle(bundle, stubIO());
    const profile = getProfile(profileId);
    const enriched = ensureFrontmatterForProfile(bundle, profile);
    expect(enriched.frontmatterRaw).toBe(fm);
  });
});
