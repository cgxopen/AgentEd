import type { Severity, ValidationIssue, ValidationResult } from '../validation/types';

export interface ValidationPanel {
  update: (result: ValidationResult) => void;
  /** Empty the panel's list and hide it. Used when validation doesn't apply to the current mode. */
  clear: () => void;
  hide: () => void;
  show: () => void;
  toggle: () => void;
}

type OnClickIssue = (issue: ValidationIssue) => void;

const SEVERITY_ICON: Record<Severity, string> = {
  error: '\u274C',
  warning: '\u26A0\uFE0F',
  info: '\u2139\uFE0F',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  info: 'Suggestions',
};

function groupBySeverity(issues: ValidationIssue[]): Map<Severity, ValidationIssue[]> {
  const groups = new Map<Severity, ValidationIssue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.severity) || [];
    list.push(issue);
    groups.set(issue.severity, list);
  }
  return groups;
}

function createIssueElement(issue: ValidationIssue, onClick: OnClickIssue): HTMLElement {
  const item = document.createElement('div');
  item.className = 'validation-item';
  item.addEventListener('click', () => onClick(issue));

  const ruleId = document.createElement('span');
  ruleId.className = 'validation-rule-id';
  ruleId.textContent = issue.ruleId;
  item.appendChild(ruleId);

  const msg = document.createElement('span');
  msg.className = 'validation-message';
  msg.textContent = issue.message;
  item.appendChild(msg);

  if (issue.line > 0) {
    const ln = document.createElement('div');
    ln.className = 'validation-line';
    ln.textContent = `Line ${issue.line}`;
    item.appendChild(ln);
  }

  if (issue.suggestion) {
    const sug = document.createElement('div');
    sug.className = 'validation-suggestion';
    sug.textContent = `Suggestion: ${issue.suggestion}`;
    item.appendChild(sug);
  }

  return item;
}

export function setupValidationPanel(onClickIssue: OnClickIssue): ValidationPanel {
  const panel = document.getElementById('validation-panel')!;
  const list = document.getElementById('validation-list')!;
  const closeBtn = document.getElementById('validation-close')!;
  const showInfoCheckbox = document.getElementById('validation-show-info') as HTMLInputElement;

  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

  let lastResult: ValidationResult | null = null;

  showInfoCheckbox.addEventListener('change', () => {
    if (lastResult) renderIssues(lastResult);
  });

  function renderIssues(result: ValidationResult): void {
    list.innerHTML = '';
    const groups = groupBySeverity(result.issues);
    const showInfo = showInfoCheckbox.checked;
    const sortedSeverities: Severity[] = ['error', 'warning', 'info'];

    for (const severity of sortedSeverities) {
      const items = groups.get(severity);
      if (!items || items.length === 0) continue;
      if (severity === 'info' && !showInfo) continue;

      const header = document.createElement('div');
      header.className = `validation-group-header validation-group-${severity}`;
      header.textContent = `${SEVERITY_ICON[severity]} ${SEVERITY_LABEL[severity]} (${items.length})`;
      list.appendChild(header);

      for (const issue of items) {
        list.appendChild(createIssueElement(issue, onClickIssue));
      }
    }

    if (result.issues.length === 0) {
      const ok = document.createElement('div');
      ok.className = 'validation-item';
      ok.textContent = '\u2705 All checks passed';
      list.appendChild(ok);
    }
  }

  function update(result: ValidationResult): void {
    lastResult = result;
    renderIssues(result);
  }

  function clear(): void {
    list.innerHTML = '';
    lastResult = null;
    panel.classList.add('hidden');
  }

  return {
    update,
    clear,
    hide: () => panel.classList.add('hidden'),
    show: () => panel.classList.remove('hidden'),
    toggle: () => panel.classList.toggle('hidden'),
  };
}

export function updateValidationIndicator(result: ValidationResult | null): void {
  const indicator = document.getElementById('validate-indicator')!;

  if (!result) {
    indicator.style.display = 'none';
    return;
  }

  indicator.style.display = '';

  const errors = result.issues.filter((i) => i.severity === 'error').length;
  const warnings = result.issues.filter((i) => i.severity === 'warning').length;

  if (errors === 0 && warnings === 0) {
    indicator.textContent = 'Validate \u2713';
    indicator.className = 'indicator validate-ok';
    indicator.title = 'Validation passed';
    return;
  }

  if (errors > 0) {
    indicator.textContent = 'Validate \u2717';
    indicator.className = 'indicator validate-error';
    indicator.title = `${errors} error(s)${warnings > 0 ? `, ${warnings} warning(s)` : ''}`;
    return;
  }

  indicator.textContent = 'Validate \u26A0';
  indicator.className = 'indicator validate-warn';
  indicator.title = `${warnings} warning(s)`;
}
