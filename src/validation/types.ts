import type { Profile } from '../profiles/types';

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  ruleId: string;
  severity: Severity;
  message: string;
  /** 1-based line number, or 0 for frontmatter / whole-document issues */
  line: number;
  context?: string;
  suggestion?: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  timestamp: number;
  durationMs: number;
}

/**
 * The validator runs every rule family on the document, then keeps
 * only the issues whose ruleId appears in `profile.activeRuleIds`.
 * Rule implementations themselves don't know which profile is active.
 */
export interface ValidationOptions {
  profile: Profile;
  suppressRules?: string[];
}

export interface ParsedFrontmatter {
  raw: string;
  name?: string;
  description?: string;
  [key: string]: string | undefined;
}

export interface ParsedDocument {
  frontmatter: ParsedFrontmatter;
  body: string;
  /** Line offset where body starts (after frontmatter) */
  bodyStartLine: number;
}
