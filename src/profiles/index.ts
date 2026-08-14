import { AGENTSKILLS_V1_PROFILE } from './agentskills-v1';
import { CLAUDE_SKILL_PROFILE } from './claude-skill';
import { LLMS_TXT_PROFILE } from './llms-txt';
import { OPENCLAW_SKILL_PROFILE } from './openclaw-skill';
import { PLAIN_PROFILE } from './plain';
import { ProfileRegistry } from './registry';
import type { DetectContext, DetectResult, Profile, ProfileId } from './types';

export { DETECT_THRESHOLD, ProfileRegistry } from './registry';
export type {
  DetectContext,
  DetectResult,
  FrontmatterRules,
  FrontmatterStatus,
  Profile,
  ProfileId,
} from './types';

/**
 * The set of built-in profiles, in detection-priority order. Order
 * matters only as the tie-breaker — actual selection runs through
 * each profile's confidence score.
 */
export const BUILT_IN_PROFILES: ReadonlyArray<Profile> = [
  LLMS_TXT_PROFILE,
  OPENCLAW_SKILL_PROFILE,
  CLAUDE_SKILL_PROFILE,
  AGENTSKILLS_V1_PROFILE,
  PLAIN_PROFILE,
];

/** App-wide singleton registry. Built-ins are registered eagerly. */
export const profileRegistry = new ProfileRegistry();
for (const profile of BUILT_IN_PROFILES) {
  profileRegistry.register(profile);
}

/** Convenience: resolve a ProfileId to its Profile via the singleton. */
export function getProfile(id: ProfileId): Profile {
  return profileRegistry.get(id);
}

/** Convenience: detect via the singleton registry. */
export function detectProfile(ctx: DetectContext): DetectResult {
  return profileRegistry.detect(ctx);
}
