import type { ValidationIssue } from '../types';

const GENERIC_FILENAMES = new Set([
  'doc.md',
  'doc1.md',
  'doc2.md',
  'file.md',
  'file1.md',
  'data.md',
  'temp.md',
  'test.md',
  'notes.md',
]);

const WINDOWS_PATH = /(?:scripts|reference|assets|agents|src|docs)[\\][a-zA-Z]/;

export function validateStructure(body: string, bodyStartLine: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lines = body.split(/\r?\n/);

  checkLineCount(lines, issues);
  checkWindowsPaths(lines, bodyStartLine, issues);
  checkGenericFilenames(body, issues);
  return issues;
}

function checkLineCount(lines: string[], issues: ValidationIssue[]): void {
  if (lines.length >= 500) {
    issues.push({
      ruleId: 'R-ST-1',
      severity: 'warning',
      line: 0,
      message: `SKILL.md body is ${lines.length} lines (recommended: under 500). Consider splitting into reference files`,
    });
  }
}

function checkWindowsPaths(
  lines: string[],
  bodyStartLine: number,
  issues: ValidationIssue[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const match = WINDOWS_PATH.exec(lines[i]);
    if (match) {
      issues.push({
        ruleId: 'R-ST-4',
        severity: 'warning',
        line: bodyStartLine + i,
        message: `Windows-style path detected: '${match[0]}'. Use forward slashes for cross-platform compatibility`,
        context: lines[i].trim(),
      });
    }
  }
}

function checkGenericFilenames(body: string, issues: ValidationIssue[]): void {
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(body)) !== null) {
    const href = match[2];
    if (href.startsWith('http://') || href.startsWith('https://')) continue;
    const filename = href.split('/').pop() || href;
    if (GENERIC_FILENAMES.has(filename.toLowerCase())) {
      issues.push({
        ruleId: 'R-ST-5',
        severity: 'info',
        line: 0,
        message: `Referenced file '${filename}' has a generic name. Use descriptive names like 'form_validation_rules.md'`,
      });
    }
  }
}
