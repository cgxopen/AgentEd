import { type LinkRefusal, resolveLinkTarget } from '../platform/link-target';
import { basename, isPathInsideRoot } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { showToast } from '../ui/toast';

/**
 * What the person reads when a relative link is not followed (#727), one
 * sentence each, naming the file where there is one. Exported so a test reads
 * what the person reads rather than a copy of it. The words are proposed on
 * the pull request, for the owner to approve.
 */
export const RELATIVE_LINK_MESSAGES: Readonly<Record<LinkRefusal, string>> = {
  'not-relative': '',
  'anchor-only': 'Going to a heading of the document is not supported yet.',
  rooted:
    'A link that starts with / is not followed, since AgentEd does not know the folder it starts from.',
  'no-document':
    'Save this document first: a relative link is followed from the folder of the document.',
  folder: 'This link names a folder; AgentEd opens markdown files.',
  'above-root': 'This link goes above the top folder of the disk, so it is not followed.',
};

export function missingTargetMessage(path: string): string {
  return `${basename(path)} was not found.`;
}

export function notMarkdownMessage(path: string): string {
  return `${basename(path)} is not a markdown file; opening other files is not supported yet.`;
}

export const NO_FOLDER_ACCESS_MESSAGE =
  'Give AgentEd access to the folder of this document to follow its relative links.';

export interface RelativeLinkDeps {
  /** The path of the open document, or null for a document with no file. */
  readonly documentPath: () => string | null;
  /** The root the files panel lists while it shows a tree, or null. */
  readonly panelRoot: () => string | null;
  readonly io: () => Promise<PlatformIO>;
  /** `docActions.openFilePath`: through the question about unsaved changes. */
  readonly openFilePath: (path: string, sidebarRoot?: string) => Promise<void>;
  /** What a refusal is told through; the toast in the application. */
  readonly tell?: (message: string) => void;
}

/**
 * Ctrl+click on a relative link (#727): a markdown file opens in this window
 * by the route of a click in the files panel, `openFilePath`, through the
 * question about unsaved changes, and with the root of the panel kept exactly
 * when the panel would keep it, the file being inside the root it lists.
 * Everything else is told in one sentence. Nothing is handed to the operating
 * system: a file that is not markdown is not opened in this round.
 */
export async function followRelativeLink(deps: RelativeLinkDeps, address: string): Promise<void> {
  const tell = deps.tell ?? ((message: string) => showToast(message, 'info'));
  const target = resolveLinkTarget(deps.documentPath(), address);
  if (target.kind === 'refused') {
    const message = RELATIVE_LINK_MESSAGES[target.reason];
    if (message !== '') tell(message);
    return;
  }
  if (!target.markdown) {
    tell(notMarkdownMessage(target.path));
    return;
  }
  const io = await deps.io();
  const presence = await io.entryPresence(target.path);
  if (presence === 'absent') {
    tell(missingTargetMessage(target.path));
    return;
  }
  // `unknown` is nothing looked at. Where the document itself answers so too,
  // nothing beside it can be read: the web build with no folder granted. A
  // desktop answers `present` for the document it has open, and a target it
  // could not look at is tried, the open saying why it failed, as a click in
  // the panel does.
  const documentPath = deps.documentPath();
  if (
    presence === 'unknown' &&
    documentPath !== null &&
    (await io.entryPresence(documentPath)) === 'unknown'
  ) {
    tell(NO_FOLDER_ACCESS_MESSAGE);
    return;
  }
  const root = deps.panelRoot();
  const keep = root !== null && isPathInsideRoot(target.path, root) ? root : undefined;
  await deps.openFilePath(target.path, keep);
}
