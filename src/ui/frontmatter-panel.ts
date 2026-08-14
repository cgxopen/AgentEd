import type { AppState } from '../app/state';
import { getProfile } from '../profiles/index';

export interface FrontmatterPanel {
  /** Sync textarea value from current state.frontmatter. */
  refresh(): void;
  /** Show or hide the collapsible panel entirely. */
  setVisible(visible: boolean): void;
}

/**
 * Visibility rule, post-ADR-030: the panel surfaces YAML editing for any
 * profile that requires frontmatter, plus any document that already has
 * frontmatter (so a `forbidden`-status profile like llms.txt can still
 * show the offending block while the user cleans it up).
 *
 * `plain` profile with no frontmatter → hidden. That collapses to the
 * Plain-workspace experience users had before — driven by context now,
 * not a global toggle.
 */
export function shouldShowFrontmatterPanel(state: AppState): boolean {
  const profile = getProfile(state.profile);
  if (profile.frontmatterRules.status === 'required') return true;
  return state.frontmatter !== null;
}

/**
 * Collapsible `<details>` above the editor that exposes the raw YAML
 * frontmatter as an editable textarea. Intentional fallback UX —
 * the visual form-field editor lands in v0.2.0.
 *
 * Edits flow straight to state.frontmatter and mark the document
 * modified. No inline YAML validation — profile detection re-runs on
 * save (wired in persistBundle).
 */
export function setupFrontmatterPanel(state: AppState): FrontmatterPanel {
  const details = document.getElementById('frontmatter-panel') as HTMLDetailsElement;
  const textarea = document.getElementById('frontmatter-input') as HTMLTextAreaElement;

  textarea.addEventListener('input', () => {
    const value = textarea.value;
    state.frontmatter = value.trim() === '' ? null : value;
    state.setModified(true);
  });

  function refresh(): void {
    textarea.value = state.frontmatter ?? '';
  }

  function setVisible(visible: boolean): void {
    details.classList.toggle('hidden', !visible);
  }

  return { refresh, setVisible };
}
