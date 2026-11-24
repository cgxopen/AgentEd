import { basename } from '../platform/paths';
import type { PlatformIO, RenameRefusal } from '../platform/types';
import type { AppState } from './state';

/**
 * File, Rename (#752, owner decisions of 2026-11-18): the open document
 * renamed in its own folder, through one native call that writes no content.
 *
 * **The order**: the file must still be there; then the R-C14 check of a save,
 * whose dialog comes first when the file changed on disk; then the name, which
 * the native command checks (extension, separator, a name taken by another
 * file); then the rename. A refusal at any step leaves the file under its old
 * name and the document as it was, and says why.
 *
 * **After it**, the path of the document moves to the new name and the R-C14
 * baseline stays, since the bytes are the same; the title, the recent list
 * (the old name replaced, not doubled), the files panel and the badges follow.
 * Unsaved changes stay unsaved (R-C3).
 *
 * The words are proposed on the pull request for AMP and the owner.
 */

/** The title of every message a rename that was not made shows. */
export const RENAME_FAILED_TITLE = 'Not renamed';

/** What the person reads for each refusal, the file kept under its old name. */
export function renameRefusalMessage(refusal: RenameRefusal): string {
  switch (refusal.kind) {
    case 'invalidName':
      return 'A name cannot be empty, and cannot contain / or \\.';
    case 'extension':
      return `AgentEd opens .md, .markdown and .mkd files, so the name cannot end in .${refusal.detail}.`;
    case 'taken':
      return `${refusal.detail} already exists in this folder. Choose another name.`;
    case 'gone':
      return RENAME_GONE_MESSAGE;
    case 'locked':
      return 'AgentEd could not rename the file because another program is using it. Close it there and try again.';
    case 'denied':
      return 'AgentEd is not allowed to rename files in this folder.';
    case 'other':
      return `AgentEd could not rename the file.\n\n${refusal.detail}`;
  }
}

/** The file is no longer where AgentEd opened it (owner decision 3). */
export const RENAME_GONE_MESSAGE =
  'The file is no longer at its place on disk, so it cannot be renamed. Save As writes the document elsewhere.';

/**
 * Whether File, Rename is offered: a document with a file, on a platform that
 * can rename (#752). Greyed for a document never saved, which Save As names
 * (owner decision 9), and on the web build, which cannot rename.
 */
export function renameAvailability(
  filePath: string | null,
  canRename: boolean,
): { rename: boolean } {
  return { rename: canRename && filePath !== null };
}

/** A rejection of the native call as a refusal, whatever shape it arrives in. */
function asRefusal(error: unknown): RenameRefusal {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    return error as RenameRefusal;
  }
  return { kind: 'other', detail: String(error) };
}

export interface RenameDeps {
  readonly state: AppState;
  readonly io: () => Promise<PlatformIO>;
  /** Ask for the new name, the current one filled in; `null` when cancelled. */
  readonly askName: (current: string) => Promise<string | null>;
  /** The R-C14 gate of `DocumentActions.readyToRename`. */
  readonly readyToRename: () => Promise<boolean>;
  readonly setFilename: (name: string, path: string) => void;
  readonly redrawPanel: () => Promise<void>;
  readonly checkLinks?: () => void;
  /** Told the old path and the new, so the report of the folder keeps the row (#766). */
  readonly renamed?: (from: string, to: string) => void;
  /** The recent list: the old name out, the new one in. */
  readonly replaceRecent: (oldPath: string, newPath: string) => void;
  readonly tell: (message: string) => Promise<void>;
}

/** File, Rename. */
export async function renameDocument(deps: RenameDeps): Promise<void> {
  const { state } = deps;
  const path = state.filePath;
  const io = await deps.io();
  if (path === null || !io.renameDocument || state.isSaving) return;

  const name = await deps.askName(basename(path));
  if (name === null) return;

  // The file must be there to be renamed: the check of a save takes a file
  // that is gone for one it may write again, which is not a rename.
  if ((await io.entryPresence(path)) === 'absent') {
    await deps.tell(RENAME_GONE_MESSAGE);
    return;
  }
  if (!(await deps.readyToRename())) return;
  // Reload or Save As may have moved the document; a rename is of the file
  // the person asked about.
  if (state.filePath !== path) return;

  let newPath: string;
  state.isSaving = true;
  try {
    newPath = await io.renameDocument(path, name);
  } catch (e) {
    await deps.tell(renameRefusalMessage(asRefusal(e)));
    return;
  } finally {
    state.isSaving = false;
  }
  if (newPath === path) return;

  state.filePath = newPath;
  deps.renamed?.(path, newPath);
  // `knownDiskText` is kept: the same bytes under a new name (R-C14).
  deps.setFilename(basename(newPath), newPath);
  if (io.pathsOutliveSession) deps.replaceRecent(path, newPath);
  await deps.redrawPanel();
  deps.checkLinks?.();
}

/**
 * The Rename dialog: one field holding the current name, its name part
 * selected so typing replaces it and keeps the extension in view. Enter
 * confirms, Escape cancels, and closing gives focus back to the document.
 */
export function setupRenameDialog(
  focusDocument: () => void,
): (current: string) => Promise<string | null> {
  const dialog = required('rename-dialog');
  const input = required('rename-name') as HTMLInputElement;
  let settle: ((value: string | null) => void) | null = null;

  function finish(value: string | null): void {
    dialog.classList.add('hidden');
    focusDocument();
    const done = settle;
    settle = null;
    done?.(value);
  }

  required('rename-confirm').addEventListener('click', () => finish(input.value));
  required('rename-cancel').addEventListener('click', () => finish(null));
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(input.value);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(null);
    }
  });

  return (current) =>
    new Promise((resolve) => {
      settle = resolve;
      input.value = current;
      dialog.classList.remove('hidden');
      input.focus();
      const dot = current.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : current.length);
    });
}

/** An element of the shipped page, or a boot-time error naming what is missing. */
function required(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`the page has no #${id}`);
  return element;
}
