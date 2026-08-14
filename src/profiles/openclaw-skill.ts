import templateBody from '../templates/openclaw-skill.md?raw';
import { ruleIdsByOrigins } from '../validation/rule-origins';
import type { DetectContext, Profile } from './types';
import { hasKeyPath } from './utils';

const RULE_IDS: ReadonlySet<string> = ruleIdsByOrigins(['spec', 'hygiene', 'openclaw-specific']);

export const OPENCLAW_SKILL_PROFILE: Profile = {
  id: 'openclaw-skill',
  displayName: 'OpenClaw SKILL',
  activeRuleIds: RULE_IDS,
  allowsImagePaste: true,
  frontmatterRules: {
    status: 'required',
    required: ['name', 'description', 'metadata.openclaw.version', 'metadata.openclaw.skillKey'],
    defaults: {
      name: '',
      description: '',
      'metadata.openclaw.version': '1.0.0',
      'metadata.openclaw.skillKey': '',
    },
  },
  detect(ctx: DetectContext): number {
    if (ctx.filename.toLowerCase() !== 'skill.md') return 0;
    if (!hasKeyPath(ctx.frontmatter, 'metadata.openclaw')) return 0;
    return 95;
  },
  getTemplate(): string {
    return templateBody;
  },
};
