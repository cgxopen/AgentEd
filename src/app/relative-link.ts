import { hasWebAddressShape, type LinkRefusal, resolveLinkTarget } from '../platform/link-target';
import { basename, isPathInsideRoot } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { ROOTED_LINK_HOW, WEB_ADDRESS_HOW, withWebAddressHow } from '../ui/links-popover';
import type { TreeRoot } from '../ui/sidebar';
import { showToast } from '../ui/toast';
import { establishedPresence } from './entry-absence';
import { handOverToSystem, notLookedAtMessage } from './system-hand-over';

/**
 * What the person reads when a relative link is not followed (#727), one
 * sentence each, naming the file where there is one. Exported so a test reads
 * what the person reads rather than a copy of it. The words are proposed on
 * the pull request, for the owner to approve.
 */
export const RELATIVE_LINK_MESSAGES: Readonly<Record<LinkRefusal, string>> = {
  'not-relative': '',
  'anchor-only': 'Going to a heading of the document is not supported yet.',
  // The second sentence, how to write it, is the one under Not checked (#779).
  rooted: `A link that starts with / is not followed, since AgentEd does not know the folder it starts from. ${ROOTED_LINK_HOW}`,
  'no-document':
    'Save this document first: a relative link is followed from the folder of the document.',
  folder: 'This link names a folder; AgentEd opens markdown files.',
  'above-root': 'This link goes above the top folder of the disk, so it is not followed.',
};

export function missingTargetMessage(path: string): string {
  return `${basename(path)} was not found.`;
}

export { notOpenedHereMessage as notMarkdownMessage } from './system-hand-over';

export function windowFailedMessage(path: string): string {
  return `${basename(path)} could not be opened in a window of its own.`;
}

export const NO_FOLDER_ACCESS_MESSAGE =
  'Give AgentEd access to the folder of this document to follow its relative links.';

export interface RelativeLinkDeps {
  /** The path of the open document, or null for a document with no file. */
  readonly documentPath: () => string | null;
  /** The root the files panel lists while it shows a tree, or null. */
  readonly panelRoot: () => TreeRoot | null;
  readonly io: () => Promise<PlatformIO>;
  /** `docActions.openFilePath`: through the question about unsaved changes. */
  readonly openFilePath: (path: string, sidebarRoot?: TreeRoot) => Promise<void>;
  /**
   * Open the file in a window of its own (#731), answering whether one was
   * asked for: `platform/index.ts` `openDocumentWindow`. No on the web build,
   * and absent where none is wired, and the file then opens in this window.
   */
  readonly openWindow?: (path: string) => Promise<boolean>;
  /** What a refusal is told through; the toast in the application. */
  readonly tell?: (message: string) => void;
}

/**
 * Ctrl+click on a relative link (#727): a markdown file opens in this window
 * by the route of a click in the files panel, `openFilePath`, through the
 * question about unsaved changes, and with the root of the panel kept exactly
 * when the panel would keep it, the file being inside the root it lists.
 *
 * **With Shift, a window of its own** (#731): the file, found present, opens
 * in a new window and this document is left as it is, with no question, since
 * nothing closes. The web build has no such window, and opens it here.
 *
 * **A file that is not markdown goes to the system** (#731), on either
 * gesture, through `handOverToSystem`. Everything else is told in one
 * sentence.
 */
export async function followRelativeLink(
  deps: RelativeLinkDeps,
  address: string,
  inNewWindow = false,
): Promise<void> {
  const tell = deps.tell ?? ((message: string) => showToast(message, 'info'));
  const target = resolveLinkTarget(deps.documentPath(), address);
  if (target.kind === 'refused') {
    const message = RELATIVE_LINK_MESSAGES[target.reason];
    if (target.reason === 'folder') tell(withWebAddressHow(message, address));
    else if (message !== '') tell(message);
    return;
  }
  const io = await deps.io();
  if (!target.markdown) {
    if (hasWebAddressShape(address) && (await toldAsWebAddress(io, target.path, tell))) return;
    await handOverToSystem(io, target.path, tell);
    return;
  }
  // The answer the broken link check gives for the same link (#729): absent
  // only where the disk was seen not to hold it, so a file in a folder that
  // could not be looked at is tried, never called missing.
  const presence = await establishedPresence(io, target.path);
  if (presence === 'absent') {
    tell(withWebAddressHow(missingTargetMessage(target.path), address));
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
  if (inNewWindow && (await openedInItsOwnWindow(deps, target.path, presence, tell))) return;
  const root = deps.panelRoot();
  const keep = root !== null && isPathInsideRoot(target.path, root.path) ? root : undefined;
  await deps.openFilePath(target.path, keep);
}

/**
 * A link with the shape of a web address whose target is not a markdown file
 * (#792): its presence is asked before the kind is refused, so what is said is
 * true and says how. Absent, it was not found; unknown, AgentEd could not look;
 * each followed by the sentence of how. Present, it answers false and the file
 * goes to the system as any other, so nothing more is followed than before.
 */
async function toldAsWebAddress(
  io: PlatformIO,
  path: string,
  tell: (message: string) => void,
): Promise<boolean> {
  const presence = await establishedPresence(io, path);
  if (presence === 'absent') tell(`${missingTargetMessage(path)} ${WEB_ADDRESS_HOW}`);
  else if (presence === 'unknown') tell(`${notLookedAtMessage(path)} ${WEB_ADDRESS_HOW}`);
  return presence !== 'present';
}

/**
 * The window of its own, or `false` for this window to open the file instead:
 * the web build, or nothing wired. A file AgentEd could not look in is not
 * given a window, which would only say it could not read it: it is said here.
 */
async function openedInItsOwnWindow(
  deps: RelativeLinkDeps,
  path: string,
  presence: 'present' | 'unknown',
  tell: (message: string) => void,
): Promise<boolean> {
  if (!deps.openWindow) return false;
  if (presence === 'unknown') {
    tell(notLookedAtMessage(path));
    return true;
  }
  try {
    return await deps.openWindow(path);
  } catch (e) {
    console.error('[link] the window of its own did not open:', path, e);
    tell(windowFailedMessage(path));
    return true;
  }
}
