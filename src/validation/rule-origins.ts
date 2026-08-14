export type RuleOrigin =
  | 'spec' // AgentSkills v1 specification
  | 'hygiene' // Universal markdown/writing hygiene
  | 'claude-convention' // Anthropic skill-creator convention
  | 'openclaw-specific' // OpenClaw runtime/registry requirement
  | 'llms-txt-spec'; // llms.txt structural requirements

/**
 * Origin of every validation rule. Profiles select rules by origin via
 * `ruleIdsByOrigins`. Rule implementations don't know their own origin;
 * this table is the single source of truth.
 *
 * When adding a new rule, add it here FIRST, then add it to the profile
 * that should activate it.
 */
export const RULE_ORIGINS: Record<string, RuleOrigin> = {
  // Frontmatter rules (src/validation/rules/frontmatter.ts)
  'R-FM-1': 'spec',
  'R-FM-2': 'spec',
  'R-FM-3': 'spec',
  'R-FM-4': 'hygiene',
  'R-FM-5': 'hygiene',
  'R-FM-6': 'claude-convention',
  'R-FM-7': 'hygiene',
  'R-FM-8': 'spec',
  'R-FM-9': 'spec',
  'R-FM-10': 'spec',
  'R-FM-11': 'hygiene',
  'R-FM-12': 'claude-convention',
  'R-FM-13': 'claude-convention',

  // Structure rules (src/validation/rules/structure.ts)
  'R-ST-1': 'spec',
  'R-ST-4': 'hygiene',
  'R-ST-5': 'hygiene',

  // Content rules (src/validation/rules/content.ts)
  'R-CT-1': 'claude-convention',
  'R-CT-2': 'claude-convention',
  'R-CT-4': 'hygiene',

  // Code rules (src/validation/rules/code.ts)
  'R-CD-1': 'hygiene',
  'R-CD-4': 'claude-convention',

  // Workflow rules (src/validation/rules/workflow.ts)
  'R-WF-1': 'claude-convention',
  'R-WF-2': 'hygiene',

  // OpenClaw rules (src/validation/rules/openclaw.ts)
  'R-OC-1': 'openclaw-specific',
  'R-OC-2': 'openclaw-specific',
  'R-OC-3': 'openclaw-specific',
  'R-OC-4': 'openclaw-specific',
  'R-OC-5': 'openclaw-specific',
  'R-OC-6': 'openclaw-specific',
  'R-OC-7': 'openclaw-specific',
  'R-OC-8': 'openclaw-specific',
  'R-OC-9': 'openclaw-specific',

  // llms.txt rules (src/validation/rules/llms-txt.ts)
  'R-LT-1': 'llms-txt-spec', // forbid frontmatter
  'R-LT-2': 'llms-txt-spec', // H1 must be the first top-level element
  'R-LT-3': 'llms-txt-spec', // blockquote must follow H1
};

export function ruleIdsByOrigins(origins: ReadonlyArray<RuleOrigin>): Set<string> {
  const allowed = new Set(origins);
  return new Set(Object.keys(RULE_ORIGINS).filter((id) => allowed.has(RULE_ORIGINS[id])));
}
