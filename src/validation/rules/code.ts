import type { ValidationIssue } from '../types';

const IMPORT_PATTERNS = /\b(import |from .+ import |require\()/;
const DEPS_HEADING = /\b(dependencies|requirements|install|setup)\b/i;
const MCP_MENTION = /\bMCP\b|tool[_\s]name/i;
const QUALIFIED_TOOL = /\w+:\w+/;

export function validateCode(body: string, bodyStartLine: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  checkDependencies(body, issues);
  checkMcpTools(body, bodyStartLine, issues);
  return issues;
}

function checkDependencies(body: string, issues: ValidationIssue[]): void {
  const hasImports = IMPORT_PATTERNS.test(body);
  if (!hasImports) return;

  const headings = body.match(/^#{1,4}\s+.+/gm) || [];
  const hasDepsSection = headings.some((h) => DEPS_HEADING.test(h));
  if (!hasDepsSection) {
    issues.push({
      ruleId: 'R-CD-1',
      severity: 'warning',
      line: 0,
      message:
        'Code imports detected but no dependencies/installation section found. Add explicit install instructions',
    });
  }
}

function checkMcpTools(body: string, bodyStartLine: number, issues: ValidationIssue[]): void {
  if (!MCP_MENTION.test(body)) return;

  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!MCP_MENTION.test(line)) continue;

    // Look for tool names that aren't fully qualified (no colon separator)
    const toolRef = line.match(/\btool[:\s]+["'`]?(\w[\w-]+)["'`]?/i);
    if (toolRef && !QUALIFIED_TOOL.test(toolRef[1])) {
      issues.push({
        ruleId: 'R-CD-4',
        severity: 'warning',
        line: bodyStartLine + i,
        message: `MCP tool '${toolRef[1]}' should use fully qualified name format: ServerName:tool_name`,
      });
    }
  }
}
