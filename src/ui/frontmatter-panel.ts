import type { AppState } from '../app/state';

export interface FrontmatterPanel {
  /** Sync textarea value from current state.frontmatter. */
  refresh(): void;
  /** Show or hide the collapsible panel entirely. */
  setVisible(visible: boolean): void;
}

/**
 * Visibility rule: the panel appears only for documents that already
 * carry a metadata block. A document without frontmatter never sees it —
 * nothing is proposed, nothing is required.
 */
export function shouldShowFrontmatterPanel(state: AppState): boolean {
  return state.frontmatter !== null;
}

/**
 * Collapsible `<details>` above the editor that exposes the raw YAML
 * metadata block as an editable textarea.
 *
 * Edits flow straight to state.frontmatter and mark the document
 * modified. Clearing the textarea drops the block from the document.
 */
export function setupFrontmatterPanel(state: AppState): FrontmatterPanel {
  const detailsEl = document.getElementById('frontmatter-panel') as HTMLDetailsElement | null;
  const textareaEl = document.getElementById('frontmatter-input') as HTMLTextAreaElement | null;
  if (!detailsEl || !textareaEl) {
    // Defensive: tests / partial mounts get a no-op handle.
    return { refresh: () => {}, setVisible: () => {} };
  }
  const details = detailsEl;
  const textarea = textareaEl;

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
