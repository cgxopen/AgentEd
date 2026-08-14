import { describe, expect, it } from 'vitest';
import { AGENTSKILLS_V1_PROFILE } from './agentskills-v1';
import { CLAUDE_SKILL_PROFILE } from './claude-skill';
import { LLMS_TXT_PROFILE } from './llms-txt';
import { OPENCLAW_SKILL_PROFILE } from './openclaw-skill';
import { PLAIN_PROFILE } from './plain';
import { ProfileRegistry } from './registry';
import type { DetectContext } from './types';

function ctx(partial: Partial<DetectContext> & Pick<DetectContext, 'filename'>): DetectContext {
  return {
    filename: partial.filename,
    frontmatter: partial.frontmatter ?? null,
    body: partial.body ?? '',
    adjacentDirectories: partial.adjacentDirectories ?? [],
  };
}

function buildRegistry(): ProfileRegistry {
  const registry = new ProfileRegistry();
  registry.register(LLMS_TXT_PROFILE);
  registry.register(OPENCLAW_SKILL_PROFILE);
  registry.register(CLAUDE_SKILL_PROFILE);
  registry.register(AGENTSKILLS_V1_PROFILE);
  registry.register(PLAIN_PROFILE);
  return registry;
}

describe('ProfileRegistry — registration', () => {
  it('rejects duplicate registration', () => {
    const registry = new ProfileRegistry();
    registry.register(PLAIN_PROFILE);
    expect(() => registry.register(PLAIN_PROFILE)).toThrow(/already registered/);
  });

  it('throws when getting an unknown profile', () => {
    const registry = new ProfileRegistry();
    expect(() => registry.get('plain')).toThrow(/Unknown profile/);
  });

  it('unregister removes a registered profile', () => {
    const registry = new ProfileRegistry();
    registry.register(PLAIN_PROFILE);
    registry.unregister('plain');
    expect(() => registry.get('plain')).toThrow(/Unknown profile/);
  });
});

describe('detect — happy paths', () => {
  it('llms.txt filename → llms-txt profile', () => {
    const result = buildRegistry().detect(ctx({ filename: 'llms.txt' }));
    expect(result.profileId).toBe('llms-txt');
  });

  it('SKILL.md with metadata.openclaw → openclaw-skill', () => {
    const result = buildRegistry().detect(
      ctx({
        filename: 'SKILL.md',
        frontmatter: { name: 'x', metadata: { openclaw: { version: '1.0.0' } } },
      }),
    );
    expect(result.profileId).toBe('openclaw-skill');
  });

  it('SKILL.md with metadata.anthropic → claude-skill', () => {
    const result = buildRegistry().detect(
      ctx({
        filename: 'SKILL.md',
        frontmatter: { name: 'x', description: 'y', metadata: { anthropic: true } },
      }),
    );
    expect(result.profileId).toBe('claude-skill');
  });

  it('SKILL.md with adjacent agents/ → claude-skill', () => {
    const result = buildRegistry().detect(
      ctx({
        filename: 'SKILL.md',
        frontmatter: { name: 'x', description: 'y' },
        adjacentDirectories: ['agents', 'assets'],
      }),
    );
    expect(result.profileId).toBe('claude-skill');
  });

  it('SKILL.md with Claude headings → claude-skill', () => {
    // 60 confidence > 50 threshold; agentskills-v1 also matches at 60
    // but registration order (claude before agentskills) breaks the tie.
    const result = buildRegistry().detect(
      ctx({
        filename: 'SKILL.md',
        frontmatter: { name: 'x', description: 'y' },
        body: '# Hello\n\n## Instructions\n\nDo X.\n\n## Examples\n\nA.\n',
      }),
    );
    expect(result.profileId).toBe('claude-skill');
  });

  it('SKILL.md with name + description but no Claude/OpenClaw markers → agentskills-v1', () => {
    const result = buildRegistry().detect(
      ctx({
        filename: 'SKILL.md',
        frontmatter: { name: 'x', description: 'y' },
        body: '# Body without claude conventions',
      }),
    );
    expect(result.profileId).toBe('agentskills-v1');
  });

  it('SKILL.md without frontmatter → claude-skill (filename-only fallback)', () => {
    // ADR-030 D2 says agentskills-v1 is the fallback "with valid
    // frontmatter, no Claude/OpenClaw markers". When there's NO
    // frontmatter at all, claude-skill takes it at confidence 55 so
    // Save As → SKILL.md gets useful injection on first save.
    const result = buildRegistry().detect(ctx({ filename: 'SKILL.md', frontmatter: null }));
    expect(result.profileId).toBe('claude-skill');
  });

  it('arbitrary filename → plain', () => {
    const result = buildRegistry().detect(ctx({ filename: 'README.md' }));
    expect(result.profileId).toBe('plain');
  });
});

describe('detect — case sensitivity', () => {
  it('matches SKILL.md case-insensitively', () => {
    const result = buildRegistry().detect(
      ctx({
        filename: 'skill.md',
        frontmatter: { name: 'x', description: 'y' },
      }),
    );
    expect(result.profileId).toBe('agentskills-v1');
  });

  it('does NOT match llms.txt with different case (e.g., LLMS.TXT)', () => {
    const result = buildRegistry().detect(ctx({ filename: 'LLMS.TXT' }));
    expect(result.profileId).toBe('plain');
  });
});

describe('detect — priority', () => {
  it('OpenClaw markers beat Claude markers when both present', () => {
    const result = buildRegistry().detect(
      ctx({
        filename: 'SKILL.md',
        frontmatter: {
          name: 'x',
          metadata: { openclaw: {}, anthropic: true },
        },
        adjacentDirectories: ['agents'],
      }),
    );
    expect(result.profileId).toBe('openclaw-skill');
  });

  it('exposes per-profile scores for diagnostics', () => {
    const result = buildRegistry().detect(ctx({ filename: 'llms.txt' }));
    const llms = result.scores.find((s) => s.id === 'llms-txt');
    expect(llms?.score).toBe(100);
    expect(result.scores.every((s) => s.score >= 0)).toBe(true);
  });
});
