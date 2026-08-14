import yaml from 'js-yaml';
import { validateCode } from './rules/code';
import { validateContent } from './rules/content';
import { validateFrontmatter } from './rules/frontmatter';
import { validateLlmsTxt } from './rules/llms-txt';
import { validateOpenClaw } from './rules/openclaw';
import { validateStructure } from './rules/structure';
import { validateWorkflows } from './rules/workflow';
import type { ParsedDocument, ValidationOptions, ValidationResult } from './types';

export type { ValidationOptions, ValidationResult } from './types';

/**
 * Run every rule family against the document, then keep only issues
 * whose ruleId is in `profile.activeRuleIds`. Rules don't know which
 * profile activates them — the registry is the single mapping point.
 */
export function runValidation(markdown: string, options: ValidationOptions): ValidationResult {
  const start = performance.now();
  const doc = parseFrontmatter(markdown);

  const allIssues = [
    ...validateFrontmatter(doc.frontmatter),
    ...validateStructure(doc.body, doc.bodyStartLine),
    ...validateContent(doc.body, doc.bodyStartLine),
    ...validateCode(doc.body, doc.bodyStartLine),
    ...validateWorkflows(doc.body, doc.bodyStartLine),
    ...validateOpenClaw(doc.frontmatter, doc.body),
    ...validateLlmsTxt(doc.frontmatter, doc.body, doc.bodyStartLine),
  ];

  const activeRuleIds = options.profile.activeRuleIds;
  const filtered = allIssues.filter((i) => activeRuleIds.has(i.ruleId));

  const issues = options.suppressRules?.length
    ? filtered.filter((i) => !options.suppressRules!.includes(i.ruleId))
    : filtered;

  return {
    issues,
    timestamp: Date.now(),
    durationMs: Math.round(performance.now() - start),
  };
}

// Length cap before YAML parsing to prevent billion-laughs / alias-bomb DoS.
// Legitimate frontmatter is well under 10 KB; anything past this threshold is
// either an attack payload or a malformed document we cannot safely parse.
const MAX_FRONTMATTER_BYTES = 100_000;

export function parseFrontmatter(markdown: string): ParsedDocument {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: { raw: '' }, body: markdown, bodyStartLine: 1 };

  const raw = match[1];
  const body = match[2];
  const fmLineCount = raw.split(/\r?\n/).length + 2;

  const fields: Record<string, string> = {};
  if (raw.length <= MAX_FRONTMATTER_BYTES) {
    try {
      const parsed = yaml.load(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (value !== null && value !== undefined) {
            fields[key] = String(value);
          }
        }
      }
    } catch {
      // Fallback: return raw without parsed fields
    }
  }

  return {
    frontmatter: { raw, ...fields },
    body,
    bodyStartLine: fmLineCount + 1,
  };
}
