import type { ParsedFrontmatter, ValidationIssue } from '../types';

/**
 * llms.txt structural rules — see Jeremy Howard's proposal at
 * https://llmstxt.org/.
 *
 *  R-LT-1: frontmatter is forbidden
 *  R-LT-2: H1 must be the first non-empty top-level element
 *  R-LT-3: a blockquote must follow the H1 (summary paragraph)
 *
 * Rules below R-LT-3 (link list shape, etc.) are deferred to v0.2.0;
 * the existing markdown parser already enforces link syntax.
 */
export function validateLlmsTxt(
  frontmatter: ParsedFrontmatter,
  body: string,
  bodyStartLine: number,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (frontmatter.raw && frontmatter.raw.trim().length > 0) {
    issues.push({
      ruleId: 'R-LT-1',
      severity: 'error',
      message: 'llms.txt files must not have YAML frontmatter — remove the --- block.',
      line: 0,
    });
  }

  const lines = body.split(/\r?\n/);
  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);

  if (firstNonEmpty === -1) {
    return issues;
  }

  const h1 = lines[firstNonEmpty];
  if (!/^#\s+\S/.test(h1)) {
    issues.push({
      ruleId: 'R-LT-2',
      severity: 'error',
      message: 'llms.txt must start with an H1 heading (e.g. "# Project Name").',
      line: bodyStartLine + firstNonEmpty,
    });
    return issues;
  }

  // After the H1, look for a blockquote. Allow blank lines between.
  let blockquoteLine = -1;
  for (let i = firstNonEmpty + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    if (line.startsWith('>')) blockquoteLine = i;
    break;
  }

  if (blockquoteLine === -1) {
    issues.push({
      ruleId: 'R-LT-3',
      severity: 'warning',
      message:
        'llms.txt should follow the H1 with a blockquote summary (one or two sentences describing the project).',
      line: bodyStartLine + firstNonEmpty,
    });
  }

  return issues;
}
