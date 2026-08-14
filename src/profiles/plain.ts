import templateBody from '../templates/plain.md?raw';
import type { DetectContext, Profile } from './types';

const RULE_IDS: ReadonlySet<string> = new Set();

/**
 * Plain profile is the universal fallback. The orchestrator returns
 * `plain` whenever no other profile clears the detection threshold —
 * detect() therefore always returns 0 here, and the registry handles
 * the fallback explicitly.
 */
export const PLAIN_PROFILE: Profile = {
  id: 'plain',
  displayName: 'Plain markdown',
  activeRuleIds: RULE_IDS,
  allowsImagePaste: true,
  frontmatterRules: {
    status: 'optional',
    required: [],
    defaults: {},
  },
  detect(_ctx: DetectContext): number {
    return 0;
  },
  getTemplate(): string {
    return templateBody;
  },
};
