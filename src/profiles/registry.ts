import type { DetectContext, DetectResult, Profile, ProfileId } from './types';

/**
 * Confidence threshold below which detection falls back to `plain`.
 * Per ADR-030: a profile must produce a strictly higher score than
 * this number to win. Tweakable but not runtime-configurable.
 */
export const DETECT_THRESHOLD = 50;

/**
 * In-process registry of profiles. Internally extensible — profiles
 * can be registered/unregistered at runtime — but the public API for
 * user-defined profiles is reserved for v0.3.0+.
 *
 * Order of registration is the tie-breaker: when two profiles return
 * the same score, the one registered first wins. Built-ins are
 * registered in priority order (`llms-txt`, `openclaw-skill`,
 * `claude-skill`, `agentskills-v1`, `plain`) at app startup.
 */
export class ProfileRegistry {
  private readonly profiles: Profile[] = [];

  register(profile: Profile): void {
    if (this.profiles.some((p) => p.id === profile.id)) {
      throw new Error(`Profile already registered: ${profile.id}`);
    }
    this.profiles.push(profile);
  }

  unregister(id: ProfileId): void {
    const index = this.profiles.findIndex((p) => p.id === id);
    if (index === -1) return;
    this.profiles.splice(index, 1);
  }

  get(id: ProfileId): Profile {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) {
      throw new Error(`Unknown profile: ${id}`);
    }
    return profile;
  }

  list(): ReadonlyArray<Profile> {
    return this.profiles;
  }

  /**
   * Pick the best-matching profile for the given context. Returns the
   * winner along with all per-profile scores so callers can surface
   * detection diagnostics if needed.
   */
  detect(ctx: DetectContext): DetectResult {
    const scores = this.profiles.map((p) => ({ id: p.id, score: p.detect(ctx) }));

    // Highest score wins; registration order breaks ties because
    // Array.prototype.sort with a stable comparator preserves it.
    const ranked = [...scores].sort((a, b) => b.score - a.score);
    const top = ranked[0];

    const profileId: ProfileId = top && top.score > DETECT_THRESHOLD ? top.id : 'plain';

    return { profileId, score: top?.score ?? 0, scores };
  }
}
