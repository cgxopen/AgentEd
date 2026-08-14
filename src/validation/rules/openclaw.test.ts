import { describe, expect, it } from 'vitest';
import type { ParsedFrontmatter } from '../types';
import { validateOpenClaw } from './openclaw';

function fm(raw: string, overrides: Record<string, string> = {}): ParsedFrontmatter {
  return { raw, ...overrides };
}

describe('R-OC-1: multi-line frontmatter hint', () => {
  it('fires when metadata key uses block form', () => {
    const raw = 'name: x\nmetadata:\n  openclaw:\n    requires:\n      bins:\n        - curl';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-1')).toBe(true);
  });

  it('does not fire for flat frontmatter', () => {
    const raw = 'name: x\ndescription: y';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-1')).toBe(false);
  });
});

describe('R-OC-2: nested metadata hint', () => {
  it('fires when metadata has nested object children', () => {
    const raw = 'name: x\nmetadata:\n  openclaw:\n    key: value';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-2')).toBe(true);
  });

  it('does not fire when metadata is absent', () => {
    const raw = 'name: x\ndescription: y';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-2')).toBe(false);
  });

  it('does not fire when metadata is present but has no OpenClaw alias', () => {
    // Skill with benign metadata (no openclaw / clawdbot / clawdis).
    // R-OC-1 and R-OC-2 must not fire — they are gated on the presence
    // of OpenClaw metadata so non-OpenClaw skills don't see false positives.
    const raw = 'name: x\nmetadata:\n  author: catge\n  license: MIT';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-1')).toBe(false);
    expect(issues.some((i) => i.ruleId === 'R-OC-2')).toBe(false);
  });
});

describe('R-OC-3: inaccessible skill', () => {
  it('fires when both disable-model-invocation and !user-invocable', () => {
    const raw =
      'name: x\ndisable-model-invocation: true\nuser-invocable: false\nmetadata:\n  openclaw: {}';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-3')).toBe(true);
  });

  it('does not fire when user-invocable is true', () => {
    const raw =
      'name: x\ndisable-model-invocation: true\nuser-invocable: true\nmetadata:\n  openclaw: {}';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-3')).toBe(false);
  });
});

describe('R-OC-4: command-dispatch requires command-tool', () => {
  it('fires when command-dispatch: true but command-tool missing', () => {
    const raw = 'name: x\ncommand-dispatch: true\nmetadata:\n  openclaw: {}';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-4')).toBe(true);
  });

  it('does not fire when command-tool is present', () => {
    const raw = 'name: x\ncommand-dispatch: true\ncommand-tool: my-tool\nmetadata:\n  openclaw: {}';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-4')).toBe(false);
  });
});

describe('R-OC-5: skillKey vs name', () => {
  it('fires when skillKey differs from name', () => {
    const raw = 'name: x\nmetadata:\n  openclaw:\n    skillKey: other';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-5')).toBe(true);
  });

  it('does not fire when skillKey matches name', () => {
    const raw = 'name: x\nmetadata:\n  openclaw:\n    skillKey: x';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-5')).toBe(false);
  });
});

describe('R-OC-6: declared deps without docs section', () => {
  it('fires when requires declared but body lacks dependencies section', () => {
    const raw = 'name: x\nmetadata:\n  openclaw:\n    requires:\n      bins: [curl]';
    const body = '# Title\n\nDoes stuff.';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), body);
    expect(issues.some((i) => i.ruleId === 'R-OC-6')).toBe(true);
  });

  it('does not fire when body has a Dependencies heading', () => {
    const raw = 'name: x\nmetadata:\n  openclaw:\n    requires:\n      bins: [curl]';
    const body = '# Title\n\n## Dependencies\n\n- curl';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), body);
    expect(issues.some((i) => i.ruleId === 'R-OC-6')).toBe(false);
  });
});

describe('R-OC-7: undeclared env references in scripts', () => {
  it('fires when shell uses $VAR not declared in requires.env', () => {
    const raw = 'name: x\nmetadata:\n  openclaw:\n    requires:\n      env: [KNOWN]';
    const body = '```bash\necho $UNKNOWN_KEY\n```';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), body);
    expect(issues.some((i) => i.ruleId === 'R-OC-7' && i.message.includes('UNKNOWN_KEY'))).toBe(
      true,
    );
  });

  it('does not fire when env var is declared', () => {
    const raw = 'name: x\nmetadata:\n  openclaw:\n    requires:\n      env: [MY_KEY]';
    const body = '```bash\necho $MY_KEY\n```';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), body);
    expect(issues.some((i) => i.ruleId === 'R-OC-7')).toBe(false);
  });
});

describe('R-OC-8: semver check', () => {
  it('fires when version is not valid semver', () => {
    const raw = 'name: x\nversion: "1.0"\nmetadata:\n  openclaw: {}';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-8')).toBe(true);
  });

  it('does not fire for valid semver', () => {
    const raw = 'name: x\nversion: 1.2.3\nmetadata:\n  openclaw: {}';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-8')).toBe(false);
  });

  it('does not fire when version is absent', () => {
    const raw = 'name: x\nmetadata:\n  openclaw: {}';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-8')).toBe(false);
  });
});

describe('R-OC-9: multiple aliases', () => {
  it('fires when both openclaw and clawdbot are present', () => {
    const raw = 'name: x\nmetadata:\n  openclaw: {}\n  clawdbot: {}';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-9')).toBe(true);
  });

  it('does not fire when only one alias is present', () => {
    const raw = 'name: x\nmetadata:\n  openclaw: {}';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    expect(issues.some((i) => i.ruleId === 'R-OC-9')).toBe(false);
  });
});

describe('no-op when OpenClaw metadata absent', () => {
  it('returns no rules beyond R-OC-1/2/9 triage when metadata missing', () => {
    const raw = 'name: x\ndescription: y';
    const issues = validateOpenClaw(fm(raw, { name: 'x' }), '');
    // None of R-OC-3..8 should fire without OpenClaw metadata.
    const triggeringIds = issues.map((i) => i.ruleId);
    expect(triggeringIds).not.toContain('R-OC-3');
    expect(triggeringIds).not.toContain('R-OC-4');
    expect(triggeringIds).not.toContain('R-OC-5');
    expect(triggeringIds).not.toContain('R-OC-6');
    expect(triggeringIds).not.toContain('R-OC-7');
    expect(triggeringIds).not.toContain('R-OC-8');
  });
});
