import templateBody from '../templates/claude-skill.md?raw';
import { ruleIdsByOrigins } from '../validation/rule-origins';
import type { DetectContext, Profile } from './types';
import { hasKeyPath } from './utils';

const RULE_IDS: ReadonlySet<string> = ruleIdsByOrigins(['spec', 'hygiene', 'claude-convention']);

/**
 * Confidence ranking (per ADR-030 D2 + product owner sign-off):
 *  - filename SKILL.md (case-insensitive) is the gate; without it score = 0
 *  - metadata.anthropic in frontmatter → 90
 *  - adjacent agents/ directory → 80
 *  - both ## Instructions and ## Examples top-level headings → 60
 *  - SKILL.md alone, no frontmatter, no other markers → 55
 *    (just-above-threshold default; gives Save As → SKILL.md a useful
 *    profile so frontmatter auto-injection runs at first save. Still
 *    loses to agentskills-v1's 60 when the user has supplied a valid
 *    AgentSkills-shaped frontmatter without Claude markers.)
 */
function isSkillFilename(filename: string): boolean {
  return filename.toLowerCase() === 'skill.md';
}

function hasClaudeHeadings(body: string): boolean {
  // Match top-level `##` headings only (markdown line-start, two hashes,
  // a space, then the literal heading). Body comes without frontmatter
  // so line-start checks are safe.
  const hasInstructions = /^##\s+Instructions\s*$/m.test(body);
  const hasExamples = /^##\s+Examples\s*$/m.test(body);
  return hasInstructions && hasExamples;
}

export const CLAUDE_SKILL_PROFILE: Profile = {
  id: 'claude-skill',
  displayName: 'Claude SKILL',
  activeRuleIds: RULE_IDS,
  allowsImagePaste: true,
  frontmatterRules: {
    status: 'required',
    required: ['name', 'description'],
    defaults: {
      name: '',
      description: '',
    },
  },
  detect(ctx: DetectContext): number {
    if (!isSkillFilename(ctx.filename)) return 0;
    // OpenClaw markers exclude Claude — the openclaw profile owns this path.
    if (hasKeyPath(ctx.frontmatter, 'metadata.openclaw')) return 0;

    if (hasKeyPath(ctx.frontmatter, 'metadata.anthropic')) return 90;
    if (ctx.adjacentDirectories.includes('agents')) return 80;
    if (hasClaudeHeadings(ctx.body)) return 60;
    // Filename-only fallback: a SKILL.md with no markers and no
    // frontmatter still defaults to Claude — the most common SKILL.md
    // dialect — so a freshly Save-As'd document gets useful frontmatter
    // injected at first save. agentskills-v1 outranks this (60) when
    // the user has typed `name` + `description` themselves.
    if (ctx.frontmatter === null) return 55;
    return 0;
  },
  getTemplate(): string {
    return templateBody;
  },
};
