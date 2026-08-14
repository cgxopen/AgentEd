import templateBody from '../templates/llms-txt.md?raw';
import { ruleIdsByOrigins } from '../validation/rule-origins';
import type { DetectContext, Profile } from './types';

const RULE_IDS: ReadonlySet<string> = ruleIdsByOrigins(['llms-txt-spec']);

/**
 * Per Jeremy Howard's llms.txt proposal (https://llmstxt.org/):
 *  - file is named exactly `llms.txt` (case-sensitive)
 *  - no YAML frontmatter
 *  - opens with H1 followed by a blockquote summary
 *  - sections are H2 with bullet lists of `[link](url): description`
 *
 * Image paste is not supported — llms.txt is a navigation index for
 * LLMs, not a document with inline media.
 */
export const LLMS_TXT_PROFILE: Profile = {
  id: 'llms-txt',
  displayName: 'llms.txt',
  activeRuleIds: RULE_IDS,
  allowsImagePaste: false,
  frontmatterRules: {
    status: 'forbidden',
    required: [],
    defaults: {},
  },
  detect(ctx: DetectContext): number {
    return ctx.filename === 'llms.txt' ? 100 : 0;
  },
  getTemplate(): string {
    return templateBody;
  },
};
