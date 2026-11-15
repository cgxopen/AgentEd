import type { AppState } from '../app/state';

export interface FrontmatterPanel {
  /** Sync textarea value from current state.frontmatter. */
  refresh(): void;
  /** Show or hide the collapsible panel entirely. */
  setVisible(visible: boolean): void;
  /** Show the panel, expand it, and put focus in its field (#297). */
  reveal(): void;
  /**
   * Open the block for a print or an export and size its field to its text,
   * since no print rule can open a `details` element (#725). Answers the
   * function that gives the block back the state it had. Neither touches the
   * text, the editor, the undo history or the unsaved marker: no `input`
   * event is raised.
   */
  openForPrint(): () => void;
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
    return {
      refresh: () => {},
      setVisible: () => {},
      reveal: () => {},
      openForPrint: () => () => {},
    };
  }
  const details = detailsEl;
  const textarea = textareaEl;

  textarea.addEventListener('input', () => {
    const value = textarea.value;
    state.frontmatter = value.trim() === '' ? null : value;
    // Asked rather than set (#441): a field changed back by hand is saved.
    state.refreshModified();
  });

  function refresh(): void {
    textarea.value = state.frontmatter ?? '';
  }

  function setVisible(visible: boolean): void {
    details.classList.toggle('hidden', !visible);
  }

  function reveal(): void {
    setVisible(true);
    details.open = true;
    textarea.focus();
  }

  function openForPrint(): () => void {
    const wasOpen = details.open;
    const height = textarea.style.height;
    details.open = true;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    return () => {
      details.open = wasOpen;
      textarea.style.height = height;
    };
  }

  return { refresh, setVisible, reveal, openForPrint };
}
