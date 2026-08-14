import type { ValidationIssue } from '../types';

const WORKFLOW_HEADING = /\b(workflow|process)\b/i;
const NUMBERED_STEP = /^\d+\.\s/;
const CHECKLIST_ITEM = /^- \[[ x]\]/;
const VALIDATION_KEYWORD = /\b(validate|verify|check|test)\b/i;
const CODE_FENCE = /^```(bash|python|sh|typescript|javascript)/;

export function validateWorkflows(body: string, bodyStartLine: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sections = extractWorkflowSections(body, bodyStartLine);

  for (const section of sections) {
    checkChecklist(section, issues);
    checkValidationStep(section, issues);
  }
  return issues;
}

interface WorkflowSection {
  heading: string;
  line: number;
  content: string;
  stepCount: number;
  hasChecklist: boolean;
  hasCodeBlock: boolean;
  hasValidationStep: boolean;
}

function extractWorkflowSections(body: string, bodyStartLine: number): WorkflowSection[] {
  const lines = body.split(/\r?\n/);
  const sections: WorkflowSection[] = [];
  let current: WorkflowSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^#{1,4}\s+(.+)/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = WORKFLOW_HEADING.test(headingMatch[1])
        ? {
            heading: headingMatch[1],
            line: bodyStartLine + i,
            content: '',
            stepCount: 0,
            hasChecklist: false,
            hasCodeBlock: false,
            hasValidationStep: false,
          }
        : null;
      continue;
    }
    if (!current) continue;
    current.content += `${lines[i]}\n`;
    if (NUMBERED_STEP.test(lines[i].trim())) current.stepCount++;
    if (CHECKLIST_ITEM.test(lines[i].trim())) current.hasChecklist = true;
    if (CODE_FENCE.test(lines[i].trim())) current.hasCodeBlock = true;
    if (VALIDATION_KEYWORD.test(lines[i])) current.hasValidationStep = true;
  }
  if (current) sections.push(current);
  return sections;
}

function checkChecklist(section: WorkflowSection, issues: ValidationIssue[]): void {
  if (section.stepCount >= 5 && !section.hasChecklist) {
    issues.push({
      ruleId: 'R-WF-1',
      severity: 'info',
      line: section.line,
      message: `Workflow '${section.heading}' has ${section.stepCount} steps but no checklist. Add a copyable checklist for Claude to track progress`,
    });
  }
}

function checkValidationStep(section: WorkflowSection, issues: ValidationIssue[]): void {
  if (section.hasCodeBlock && !section.hasValidationStep) {
    issues.push({
      ruleId: 'R-WF-2',
      severity: 'info',
      line: section.line,
      message: `Workflow '${section.heading}' includes code execution but no validation step. Add a verify/validate step`,
    });
  }
}
