import { isTauri } from '../platform/detect';
import { listenForFileOpen } from '../platform/file-open';

/**
 * Open the document the OS or the command line hands the desktop build
 * (R-C11), through `openFilePath`, so a document already open with unsaved
 * changes meets the gate first.
 *
 * What arrives differs by platform. On Windows and Linux, a path in the
 * command line at start-up, once: every launch is its own window (R-C8), so
 * a second file opened from the file manager starts a second AgentEd. On
 * macOS, a path at start-up and again whenever a file is opened from Finder
 * or Open With while AgentEd runs, since LaunchServices hands it to the
 * running instance: that one replaces the document in this window (#541).
 *
 * No-op in the web build — File System Access API doesn't surface CLI
 * args or OS file associations.
 */
export function setupFileAssociation(openFilePath: (path: string) => Promise<void>): void {
  if (!isTauri) return;

  const open = (path: string): void => {
    void openFilePath(path).catch(console.error);
  };
  void listenForFileOpen(open).catch(console.error);
}
