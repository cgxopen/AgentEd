import type { ParsedFrontmatter, ValidationIssue } from '../types';

const VAGUE_NAMES = new Set(['helper', 'utils', 'tools', 'documents', 'data', 'files']);
const RESERVED_WORDS = ['anthropic', 'claude'];
const PERSON_START = /^(I |You |We )/i;
const PERSON_PHRASES = /\b(I can|you can|I help|you should|I will|you will)\b/i;
const TRIGGER_PATTERNS = /\b(use when|trigger|use for|when the user|when working with)\b/i;

export function validateFrontmatter(fm: ParsedFrontmatter): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateName(fm, issues);
  validateDescription(fm, issues);
  return issues;
}

function validateName(fm: ParsedFrontmatter, issues: ValidationIssue[]): void {
  if (fm.name === undefined) {
    issues.push({
      ruleId: 'R-FM-1',
      severity: 'error',
      message: 'Frontmatter missing required field: name',
      line: 0,
    });
    return;
  }

  // Per ADR-030 D2: auto-injected empty defaults must surface as
  // warnings (the user "must complete"), not blocking errors.
  if (fm.name.trim().length === 0) {
    issues.push({
      ruleId: 'R-FM-1',
      severity: 'warning',
      message: 'Frontmatter field "name" is empty — please complete it',
      line: 0,
    });
    return;
  }

  const name = fm.name;

  if (name.length > 64) {
    issues.push({
      ruleId: 'R-FM-2',
      severity: 'error',
      message: `Skill name exceeds 64 characters (${name.length} chars)`,
      line: 0,
    });
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    issues.push({
      ruleId: 'R-FM-3',
      severity: 'error',
      line: 0,
      message:
        'Skill name contains invalid characters. Use only lowercase letters, numbers, and hyphens',
      suggestion: name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-'),
    });
  }

  if (/<|>/.test(name)) {
    issues.push({
      ruleId: 'R-FM-4',
      severity: 'error',
      message: 'Skill name must not contain XML tags',
      line: 0,
    });
  }

  for (const word of RESERVED_WORDS) {
    if (name.includes(word)) {
      issues.push({
        ruleId: 'R-FM-5',
        severity: 'error',
        line: 0,
        message: `Skill name must not contain reserved words: '${word}'`,
      });
    }
  }

  if (!name.endsWith('-ing') && !/-ing-/.test(name)) {
    issues.push({
      ruleId: 'R-FM-6',
      severity: 'info',
      line: 0,
      message:
        "Consider using gerund form for skill name (e.g., 'processing-pdfs' instead of 'pdf-processor')",
    });
  }

  if (VAGUE_NAMES.has(name)) {
    issues.push({
      ruleId: 'R-FM-7',
      severity: 'warning',
      line: 0,
      message:
        "Skill name is too generic. Use a descriptive name that indicates the skill's purpose",
    });
  }
}

function validateDescription(fm: ParsedFrontmatter, issues: ValidationIssue[]): void {
  if (!fm.description && fm.description !== '') {
    issues.push({
      ruleId: 'R-FM-8',
      severity: 'error',
      message: 'Frontmatter missing required field: description',
      line: 0,
    });
    return;
  }

  const desc = fm.description ?? '';

  if (desc.trim().length === 0) {
    // Per ADR-030 D2: auto-injected `description: ""` is expected on
    // freshly-templated documents; surface as a warning ("please
    // complete") rather than a blocking error.
    issues.push({
      ruleId: 'R-FM-9',
      severity: 'warning',
      message: 'Skill description is empty — please complete it',
      line: 0,
    });
    return;
  }

  if (desc.length > 1024) {
    issues.push({
      ruleId: 'R-FM-10',
      severity: 'error',
      line: 0,
      message: `Skill description exceeds 1024 characters (${desc.length} chars)`,
    });
  }

  if (/<[a-zA-Z/]/.test(desc)) {
    issues.push({
      ruleId: 'R-FM-11',
      severity: 'error',
      message: 'Skill description must not contain XML tags',
      line: 0,
    });
  }

  if (PERSON_START.test(desc) || PERSON_PHRASES.test(desc)) {
    issues.push({
      ruleId: 'R-FM-12',
      severity: 'warning',
      line: 0,
      message:
        "Description should use third person. Instead of 'I can help…' or 'You can use…', write 'Processes…' or 'Extracts…'",
    });
  }

  if (!TRIGGER_PATTERNS.test(desc)) {
    issues.push({
      ruleId: 'R-FM-13',
      severity: 'info',
      line: 0,
      message:
        "Description should include when to use the skill (e.g., 'Use when…', 'Triggers on…')",
    });
  }
}
