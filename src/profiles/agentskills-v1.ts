import templateBody from '../templates/agentskills-v1.md?raw';
import { ruleIdsByOrigins } from '../validation/rule-origins';
import type { DetectContext, Profile } from './types';
import { hasKeyPath } from './utils';

const RULE_IDS: ReadonlySet<string> = ruleIdsByOrigins(['spec', 'hygiene']);

/**
 * AgentSkills v1 fallback for SKILL.md files without Claude or OpenClaw
 * markers. Detection requires a name + description in frontmatter — this
 * is the spec's hard floor; without those fields a SKILL.md is treated
 * as plain markdown.
 */
function hasMinimumFrontmatter(frontmatter: Record<string, unknown> | null): boolean {
  return hasKeyPath(frontmatter, 'name') && hasKeyPath(frontmatter, 'description');
}

export const AGENTSKILLS_V1_PROFILE: Profile = {
  id: 'agentskills-v1',
  displayName: 'AgentSkills v1',
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
    if (ctx.filename.toLowerCase() !== 'skill.md') return 0;
    if (hasKeyPath(ctx.frontmatter, 'metadata.openclaw')) return 0;
    if (hasKeyPath(ctx.frontmatter, 'metadata.anthropic')) return 0;
    if (!hasMinimumFrontmatter(ctx.frontmatter)) return 0;
    return 60;
  },
  getTemplate(): string {
    return templateBody;
  },
};
