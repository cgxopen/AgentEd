import { describe, expect, it } from 'vitest';
import { getProfile } from '../profiles/index';
import { parseFrontmatter, runValidation } from './index';

const CLAUDE_SKILL = getProfile('claude-skill');
const OPENCLAW_SKILL = getProfile('openclaw-skill');
const AGENTSKILLS_V1 = getProfile('agentskills-v1');
const LLMS_TXT = getProfile('llms-txt');
const PLAIN = getProfile('plain');

describe('runValidation — claude-skill profile', () => {
  it('reports R-FM-1 when frontmatter name is missing', () => {
    const md = '---\ndescription: only desc\n---\n# Body';
    const result = runValidation(md, { profile: CLAUDE_SKILL });
    expect(result.issues.some((i) => i.ruleId === 'R-FM-1')).toBe(true);
  });

  it('produces no errors for a minimal valid skill frontmatter', () => {
    const md =
      '---\nname: my-skill\n' +
      'description: Use when the user asks for processing-something to test the validator.\n' +
      '---\n# Body';
    const result = runValidation(md, { profile: CLAUDE_SKILL });
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBe(0);
  });

  it('respects suppressRules option', () => {
    const md = '---\ndescription: only desc\n---\n# Body';
    const without = runValidation(md, { profile: CLAUDE_SKILL });
    expect(without.issues.some((i) => i.ruleId === 'R-FM-1')).toBe(true);
    const withSuppress = runValidation(md, {
      profile: CLAUDE_SKILL,
      suppressRules: ['R-FM-1'],
    });
    expect(withSuppress.issues.some((i) => i.ruleId === 'R-FM-1')).toBe(false);
  });
});

describe('runValidation — profile-specific filtering', () => {
  it('agentskills-v1 omits claude-convention rules (R-FM-13)', () => {
    // A description without the "use when" trigger would fire R-FM-13
    // under Claude, but agentskills-v1 excludes claude-convention rules.
    const md =
      '---\nname: my-skill\ndescription: processes markdown documents in batch mode.\n---\n# Body';
    const result = runValidation(md, { profile: AGENTSKILLS_V1 });
    expect(result.issues.some((i) => i.ruleId === 'R-FM-13')).toBe(false);
  });

  it('claude-skill omits R-OC-* rules even when openclaw frontmatter present', () => {
    const md = '---\nname: my-skill\ndescription: y\nmetadata:\n  openclaw: {}\n---\n# Body';
    const result = runValidation(md, { profile: CLAUDE_SKILL });
    expect(result.issues.some((i) => i.ruleId.startsWith('R-OC-'))).toBe(false);
  });

  it('openclaw-skill includes R-OC-4 when command-dispatch is set without command-tool', () => {
    const md =
      '---\nname: my-skill\ncommand-dispatch: true\nmetadata:\n  openclaw: {}\n---\n# Body';
    const result = runValidation(md, { profile: OPENCLAW_SKILL });
    expect(result.issues.some((i) => i.ruleId === 'R-OC-4')).toBe(true);
  });

  it('openclaw-skill omits claude-convention R-FM-6 (gerund suggestion)', () => {
    const md = '---\nname: process-files\ndescription: y\nmetadata:\n  openclaw: {}\n---\n# Body';
    const result = runValidation(md, { profile: OPENCLAW_SKILL });
    expect(result.issues.some((i) => i.ruleId === 'R-FM-6')).toBe(false);
  });
});

describe('runValidation — llms-txt profile', () => {
  it('reports R-LT-1 when YAML frontmatter is present', () => {
    const md = '---\ntitle: x\n---\n# Project\n\n> summary\n';
    const result = runValidation(md, { profile: LLMS_TXT });
    expect(result.issues.some((i) => i.ruleId === 'R-LT-1')).toBe(true);
  });

  it('reports R-LT-2 when no H1 is present', () => {
    const md = 'No heading here\n\n> summary\n';
    const result = runValidation(md, { profile: LLMS_TXT });
    expect(result.issues.some((i) => i.ruleId === 'R-LT-2')).toBe(true);
  });

  it('reports R-LT-3 (warning) when H1 is not followed by a blockquote', () => {
    const md = '# Project\n\n## Documentation\n\n- [a](https://x): y\n';
    const result = runValidation(md, { profile: LLMS_TXT });
    expect(result.issues.some((i) => i.ruleId === 'R-LT-3')).toBe(true);
  });

  it('no llms-txt issues for a well-formed document', () => {
    const md = '# Project\n\n> A short summary.\n\n## Documentation\n\n- [a](https://x): y\n';
    const result = runValidation(md, { profile: LLMS_TXT });
    const ltIssues = result.issues.filter((i) => i.ruleId.startsWith('R-LT-'));
    expect(ltIssues.length).toBe(0);
  });
});

describe('runValidation — plain profile', () => {
  it('produces zero issues regardless of content', () => {
    const md = '---\nname: x\n---\n# Heading\n\nany content here.';
    const result = runValidation(md, { profile: PLAIN });
    expect(result.issues.length).toBe(0);
  });
});

describe('parseFrontmatter — YAML DoS hardening (M3)', () => {
  it('parses normal frontmatter under the size cap', () => {
    const md = '---\nname: my-skill\ndescription: short\n---\nBody';
    const parsed = parseFrontmatter(md);
    expect(parsed.frontmatter.name).toBe('my-skill');
    expect(parsed.frontmatter.description).toBe('short');
    expect(parsed.body).toBe('Body');
  });

  it('skips yaml.load when raw frontmatter exceeds 100 KB', () => {
    // 120 KB of pathological alias-bomb-style YAML — exceeds the 100 KB cap.
    // Without the cap, js-yaml would happily expand aliases until OOM.
    const padding = 'x'.repeat(120_000);
    const md = `---\nname: my-skill\npayload: ${padding}\n---\nBody`;
    const start = performance.now();
    const parsed = parseFrontmatter(md);
    const elapsed = performance.now() - start;
    // Cap-skip should be effectively instant (no YAML parse). Generous bound.
    expect(elapsed).toBeLessThan(50);
    // Raw is preserved so the editor can still display the frontmatter,
    // but parsed fields are empty because we skipped yaml.load entirely.
    expect(parsed.frontmatter.raw.length).toBeGreaterThan(100_000);
    expect(parsed.frontmatter.name).toBeUndefined();
  });

  it('still skip-parses even when YAML alias-bomb pattern is present', () => {
    const aliasBomb =
      'a: &a [x,x,x,x,x,x,x,x,x]\n' +
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\n' +
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\n' +
      // Padded to exceed the cap so the guard fires.
      `padding: ${'y'.repeat(100_000)}\n`;
    const md = `---\n${aliasBomb}---\nBody`;
    const parsed = parseFrontmatter(md);
    expect(parsed.frontmatter.a).toBeUndefined();
    expect(parsed.body).toBe('Body');
  });
});
