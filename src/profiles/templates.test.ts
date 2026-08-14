/**
 * Template integrity + composition coverage (M5 of ADR-030). Verifies
 * that each built-in profile's template:
 *
 *   - parses cleanly into frontmatter + body via splitFrontmatter
 *   - matches the frontmatter rules declared by its profile
 *   - validation against the active profile yields the warnings
 *     callers expect on a freshly-seeded document (empty name /
 *     description for skill profiles, no llms-txt errors on the
 *     llms.txt template, etc.)
 */
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../formats/frontmatter';
import { runValidation } from '../validation/index';
import { getProfile } from './index';
import type { ProfileId } from './types';

const SKILL_PROFILES: ProfileId[] = ['claude-skill', 'openclaw-skill', 'agentskills-v1'];

describe('template content', () => {
  it.each(SKILL_PROFILES)('%s template seeds frontmatter with name + description', (id) => {
    const template = getProfile(id).getTemplate();
    const { raw, body } = splitFrontmatter(template);
    expect(raw).not.toBeNull();
    expect(raw).toMatch(/name:/);
    expect(raw).toMatch(/description:/);
    expect(body.length).toBeGreaterThan(0);
  });

  it('openclaw-skill template includes the metadata.openclaw block', () => {
    const { raw } = splitFrontmatter(getProfile('openclaw-skill').getTemplate());
    expect(raw).toMatch(/metadata:/);
    expect(raw).toMatch(/openclaw:/);
    expect(raw).toMatch(/version:/);
    expect(raw).toMatch(/skillKey:/);
  });

  it('llms-txt template starts with H1 + blockquote and has no frontmatter', () => {
    const template = getProfile('llms-txt').getTemplate();
    const { raw, body } = splitFrontmatter(template);
    expect(raw).toBeNull();
    const lines = body.split(/\r?\n/);
    expect(lines[0]).toMatch(/^#\s+/);
    // skip blank line, then expect blockquote
    const after = lines.slice(1).find((line) => line.trim().length > 0);
    expect(after).toMatch(/^>/);
  });

  it('plain template is empty (zero-byte document)', () => {
    expect(getProfile('plain').getTemplate()).toBe('');
  });
});

describe('template + validation composition (Save As → SKILL.md path)', () => {
  it('claude-skill template surfaces R-FM-9 (description empty) as a warning', () => {
    const profile = getProfile('claude-skill');
    const result = runValidation(profile.getTemplate(), { profile });
    // R-FM-9 fires when description is present but empty/whitespace
    const fm9 = result.issues.find((i) => i.ruleId === 'R-FM-9');
    expect(fm9).toBeDefined();
    expect(fm9?.severity).not.toBe('error');
  });

  it('llms-txt template validates clean (no R-LT-* issues)', () => {
    const profile = getProfile('llms-txt');
    const result = runValidation(profile.getTemplate(), { profile });
    const ltIssues = result.issues.filter((i) => i.ruleId.startsWith('R-LT-'));
    expect(ltIssues).toEqual([]);
  });

  it('plain template produces zero validation issues', () => {
    const profile = getProfile('plain');
    const result = runValidation(profile.getTemplate(), { profile });
    expect(result.issues).toEqual([]);
  });
});
