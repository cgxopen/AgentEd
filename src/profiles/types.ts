/**
 * Profile Registry — primary axis (ADR-030).
 *
 * A Profile is a self-contained description of one document type that
 * AgentEd recognizes: how to detect it from filename + content, which
 * validation rules apply, what frontmatter (if any) it expects, and
 * which template body to seed when creating one fresh.
 *
 * Five built-in profiles ship at v0.1.0. The registry is internally
 * extensible (`register` / `unregister`) but the public extension point
 * is reserved for v0.3.0+.
 */

export type ProfileId = 'claude-skill' | 'openclaw-skill' | 'agentskills-v1' | 'llms-txt' | 'plain';

export type FrontmatterStatus = 'required' | 'optional' | 'forbidden';

/**
 * What frontmatter looks like for this profile.
 *
 *  - `required`: save-time auto-injection fills missing fields with
 *    `defaults`. No field is locked — the user can edit any value.
 *  - `optional`: never auto-injected; respected if present.
 *  - `forbidden`: a validation error is raised if present.
 */
export interface FrontmatterRules {
  readonly status: FrontmatterStatus;
  /** Field names (dot-paths) that must exist after auto-injection. */
  readonly required: ReadonlyArray<string>;
  /** Default values keyed by dot-path. Used to seed missing fields. */
  readonly defaults: Readonly<Record<string, string>>;
}

/**
 * Inputs to `Profile.detect`. `adjacentDirectories` lets profiles
 * factor in filesystem signals (e.g. an `agents/` folder next to a
 * `SKILL.md` is a strong Claude marker) without each profile owning
 * its own I/O.
 */
export interface DetectContext {
  /** Filename basename (e.g. `SKILL.md`, `llms.txt`). */
  readonly filename: string;
  /** Parsed frontmatter as a plain object, or null when absent. */
  readonly frontmatter: Record<string, unknown> | null;
  /** Markdown body without frontmatter. */
  readonly body: string;
  /**
   * Names of directories present in the document root (relative paths
   * such as `agents`, `assets`, `references`). Empty when not known.
   */
  readonly adjacentDirectories: ReadonlyArray<string>;
}

export interface Profile {
  /** Stable id used for persistence and UI. */
  readonly id: ProfileId;
  /** User-facing label (e.g. shown in the statusbar). */
  readonly displayName: string;
  /**
   * Confidence that this profile applies to the given context, in
   * `[0, 100]`. The orchestrator picks the highest score above the
   * detection threshold; ties are broken by registration priority.
   */
  detect(ctx: DetectContext): number;
  /** Rule IDs the validator runs for this profile. */
  readonly activeRuleIds: ReadonlySet<string>;
  /** Frontmatter requirements + defaults for save-time injection. */
  readonly frontmatterRules: FrontmatterRules;
  /** Markdown source for `File → New from Template`. */
  getTemplate(): string;
  /** Whether image paste/drop is permitted under this profile. */
  readonly allowsImagePaste: boolean;
}

/** Result of an explicit detection pass; returned for diagnostics. */
export interface DetectResult {
  readonly profileId: ProfileId;
  readonly score: number;
  /** Per-profile scores, useful for debug UI. */
  readonly scores: ReadonlyArray<{ id: ProfileId; score: number }>;
}
