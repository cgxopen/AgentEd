/**
 * Per-profile validation matrix (M7.1 of ADR-030).
 *
 * Five built-in profiles × at least three scenarios each (one valid +
 * two failure-mode shapes). Lives alongside `validation/index.test.ts`
 * — that file covers cross-profile filtering invariants; this one
 * exhaustively walks each profile's specific surface.
 */
import { describe, expect, it } from 'vitest';
import { runValidation } from '../validation/index';
import { getProfile } from './index';

describe('claude-skill matrix', () => {
  it('valid: full frontmatter + Claude headings → no errors', () => {
    const md =
      '---\nname: my-skill\n' +
      'description: Use this skill when the user asks for processing-something.\n' +
      '---\n# My Skill\n\n## Instructions\n\nDo X.\n\n## Examples\n\nA.\n';
    const result = runValidation(md, { profile: getProfile('claude-skill') });
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('missing description (R-FM-8 error) when frontmatter omits the field', () => {
    const md = '---\nname: my-skill\n---\n# Body\n';
    const result = runValidation(md, { profile: getProfile('claude-skill') });
    expect(result.issues.some((i) => i.ruleId === 'R-FM-8' && i.severity === 'error')).toBe(true);
  });

  it('Claude headings without frontmatter → R-FM-1 + R-FM-8 errors', () => {
    const md = '# Skill\n\n## Instructions\n\nDo X.\n\n## Examples\n\nA.\n';
    const result = runValidation(md, { profile: getProfile('claude-skill') });
    const errors = result.issues.filter((i) => i.severity === 'error').map((i) => i.ruleId);
    expect(errors).toContain('R-FM-1');
    expect(errors).toContain('R-FM-8');
  });
});

describe('openclaw-skill matrix', () => {
  it('valid: full frontmatter with matching skillKey + valid semver → no errors', () => {
    const md =
      '---\nname: my-skill\n' +
      'description: Use this skill when the user asks for processing-something.\n' +
      'version: "1.2.3"\n' +
      'metadata:\n  openclaw:\n    skillKey: my-skill\n---\n# Body\n';
    const result = runValidation(md, { profile: getProfile('openclaw-skill') });
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('skillKey mismatch → R-OC-5 error', () => {
    const md =
      '---\nname: my-skill\ndescription: y\n' +
      'metadata:\n  openclaw:\n    skillKey: different-key\n---\n# Body\n';
    const result = runValidation(md, { profile: getProfile('openclaw-skill') });
    expect(result.issues.some((i) => i.ruleId === 'R-OC-5' && i.severity === 'error')).toBe(true);
  });

  it('invalid semver in top-level version → R-OC-8 warning', () => {
    const md =
      '---\nname: my-skill\ndescription: y\n' +
      'version: "not-a-semver"\n' +
      'metadata:\n  openclaw:\n    skillKey: my-skill\n---\n# Body\n';
    const result = runValidation(md, { profile: getProfile('openclaw-skill') });
    expect(result.issues.some((i) => i.ruleId === 'R-OC-8' && i.severity === 'warning')).toBe(true);
  });
});

describe('agentskills-v1 matrix', () => {
  it('valid: minimal frontmatter (name + description) → no errors', () => {
    const md = '---\nname: my-skill\ndescription: y\n---\n# Body\n';
    const result = runValidation(md, { profile: getProfile('agentskills-v1') });
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('missing both name + description → R-FM-1 + R-FM-8 errors', () => {
    const md = '# Body\n';
    const result = runValidation(md, { profile: getProfile('agentskills-v1') });
    const errors = result.issues.filter((i) => i.severity === 'error').map((i) => i.ruleId);
    expect(errors).toContain('R-FM-1');
    expect(errors).toContain('R-FM-8');
  });

  it('malformed YAML frontmatter degrades gracefully → R-FM-1 + R-FM-8 errors (no crash)', () => {
    // js-yaml fails silently; ParsedFrontmatter ends up without name/description fields.
    const md = '---\nname: my-skill\n  invalid: indentation\n: missing-key\n---\n# Body\n';
    const result = runValidation(md, { profile: getProfile('agentskills-v1') });
    const errors = result.issues.filter((i) => i.severity === 'error').map((i) => i.ruleId);
    expect(errors).toContain('R-FM-1');
    expect(errors).toContain('R-FM-8');
  });
});

describe('llms-txt matrix', () => {
  it('valid: H1 + blockquote + sections + no frontmatter → no issues', () => {
    const md = '# Project\n\n> A short summary.\n\n## Documentation\n\n- [a](https://x): y\n';
    const result = runValidation(md, { profile: getProfile('llms-txt') });
    expect(result.issues).toEqual([]);
  });

  it('frontmatter present (forbidden) → R-LT-1 error', () => {
    const md = '---\ntitle: x\n---\n# Project\n\n> summary\n';
    const result = runValidation(md, { profile: getProfile('llms-txt') });
    expect(result.issues.some((i) => i.ruleId === 'R-LT-1' && i.severity === 'error')).toBe(true);
  });

  it('H1 not followed by blockquote → R-LT-3 warning', () => {
    // R-LT-4 (H2 sections must contain bullet lists) is deferred to v0.2.0
    // per src/validation/rules/llms-txt.ts; the closest current shape we
    // can exercise is H1 → no blockquote.
    const md = '# Project\n\n## Documentation\n\n- [a](https://x): y\n';
    const result = runValidation(md, { profile: getProfile('llms-txt') });
    expect(result.issues.some((i) => i.ruleId === 'R-LT-3' && i.severity === 'warning')).toBe(true);
  });
});

describe('plain matrix', () => {
  it('any markdown with frontmatter → zero issues (plain has no rules)', () => {
    const md = '---\nname: x\n---\n# Heading\n\nany content here.';
    const result = runValidation(md, { profile: getProfile('plain') });
    expect(result.issues).toEqual([]);
  });

  it('empty document → zero issues', () => {
    const result = runValidation('', { profile: getProfile('plain') });
    expect(result.issues).toEqual([]);
  });

  it("document with broken syntax → zero issues (plain doesn't police)", () => {
    const md = '---\ngarbage here\n  not yaml\n---\n# Heading\n```\nunclosed code\n';
    const result = runValidation(md, { profile: getProfile('plain') });
    expect(result.issues).toEqual([]);
  });
});
