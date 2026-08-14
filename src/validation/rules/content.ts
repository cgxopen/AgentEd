import { SYNONYM_GROUPS } from '../synonyms';
import type { ValidationIssue } from '../types';

const TIME_PATTERNS = [
  /\b(before|after) (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/i,
  /\bstarting (from )?Q[1-4] \d{4}\b/i,
  /\buntil \d{4}\b/i,
  /\bdeprecated in \d{4}\b/i,
  /\bwill be removed\b/i,
  /\bas of (January|February|March|April|May|June|July|August|September|October|November|December|\d{4})\b/i,
];

export function validateContent(body: string, bodyStartLine: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  checkTimeSensitive(body, bodyStartLine, issues);
  checkTerminology(body, issues);
  checkExampleSections(body, bodyStartLine, issues);
  return issues;
}

function checkTimeSensitive(body: string, bodyStartLine: number, issues: ValidationIssue[]): void {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of TIME_PATTERNS) {
      const match = pattern.exec(lines[i]);
      if (match) {
        issues.push({
          ruleId: 'R-CT-1',
          severity: 'warning',
          line: bodyStartLine + i,
          message: `Potentially time-sensitive content: '${match[0]}'. Use 'Current method' / 'Old patterns' sections instead`,
          context: lines[i].trim(),
        });
        break; // one match per line is enough
      }
    }
  }
}

function checkTerminology(body: string, issues: ValidationIssue[]): void {
  const lowerBody = body.toLowerCase();
  for (const group of SYNONYM_GROUPS) {
    const found = group.filter((term) => {
      const re = new RegExp(`\\b${escapeRegex(term.toLowerCase())}\\b`, 'g');
      const matches = lowerBody.match(re);
      return matches && matches.length >= 2;
    });
    if (found.length >= 2) {
      issues.push({
        ruleId: 'R-CT-2',
        severity: 'info',
        line: 0,
        message: `Inconsistent terminology: both '${found[0]}' and '${found[1]}' used. Pick one and use it throughout`,
      });
    }
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkExampleSections(
  body: string,
  bodyStartLine: number,
  issues: ValidationIssue[],
): void {
  const lines = body.split(/\r?\n/);
  let inExampleSection = false;
  let exampleHeading = '';
  let exampleLine = 0;
  let hasCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      if (inExampleSection && !hasCodeBlock) {
        issues.push({
          ruleId: 'R-CT-4',
          severity: 'info',
          line: exampleLine,
          message: `Example section '${exampleHeading}' has no code blocks or concrete input/output. Add specific examples`,
        });
      }
      inExampleSection = /example/i.test(headingMatch[1]);
      exampleHeading = headingMatch[1];
      exampleLine = bodyStartLine + i;
      hasCodeBlock = false;
      continue;
    }
    if (inExampleSection && lines[i].startsWith('```')) {
      hasCodeBlock = true;
    }
  }
  // Check last section
  if (inExampleSection && !hasCodeBlock) {
    issues.push({
      ruleId: 'R-CT-4',
      severity: 'info',
      line: exampleLine,
      message: `Example section '${exampleHeading}' has no code blocks or concrete input/output. Add specific examples`,
    });
  }
}
