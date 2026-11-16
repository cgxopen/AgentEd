import { basename, isSystemOpenPath } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { establishedPresence } from './entry-absence';
import { reportSystemOpenFailure } from './system-open-failure';

/**
 * Ctrl+click on a relative link to a file that is not markdown (#731): it
 * opens with the application of the system, as a click in the files panel
 * does, under the three conditions the owner accepted on #731.
 *
 *  1. **One of the ten kinds** of the `shell.open` scope, `SYSTEM_OPEN_EXTENSIONS`:
 *     a file of another kind is refused here, in the words of the files panel,
 *     and nothing is handed over.
 *  2. **Its presence established as present** (owner decision on #731): absent
 *     is said, naming the file; unknown, a folder AgentEd cannot look in, hands
 *     nothing and says why. This is where the route differs from the markdown
 *     one of #727, which tries a file it could not look at: R-C1 says a file is
 *     handed to the system only after AgentEd has found it on the disk.
 *  3. **The message names the file**, not the text of the link.
 *
 * The path is the resolver's (#727), so from a document on a local disk it is
 * never a path on another machine; `openWithSystem` turns it into the spelling
 * the shell reads. A build that cannot hand a file over, the web, keeps the
 * sentence of #727 and hands nothing.
 */

export function openingMessage(path: string): string {
  return `Opening ${basename(path)} with the system viewer…`;
}

export function notLookedAtMessage(path: string): string {
  return `AgentEd could not look in the folder of ${basename(path)}, so it is not opened.`;
}

/** The words of the files panel when the system is not handed a file (#448). */
export function refusedKindMessage(path: string): string {
  return `Could not open ${basename(path)}.`;
}

export function notOpenedHereMessage(path: string): string {
  return `${basename(path)} is not a markdown file; opening other files is not supported yet.`;
}

export function missingMessage(path: string): string {
  return `${basename(path)} was not found.`;
}

/**
 * Hand the file at `path` to the system, or say why not. `tell` is the info
 * toast in the application; a failure of the system itself goes to the error
 * toast the files panel uses.
 */
export async function handOverToSystem(
  io: PlatformIO,
  path: string,
  tell: (message: string) => void,
): Promise<void> {
  if (!io.opensFilesWithSystem) {
    tell(notOpenedHereMessage(path));
    return;
  }
  if (!isSystemOpenPath(path)) {
    tell(refusedKindMessage(path));
    return;
  }
  const presence = await establishedPresence(io, path);
  if (presence === 'absent') {
    tell(missingMessage(path));
    return;
  }
  if (presence === 'unknown') {
    tell(notLookedAtMessage(path));
    return;
  }
  try {
    await io.openWithSystem(path);
    tell(openingMessage(path));
  } catch (e) {
    // No application for the kind, or a file gone since it was found: the
    // person is told, as the files panel tells them (#448).
    reportSystemOpenFailure(basename(path), e);
  }
}
