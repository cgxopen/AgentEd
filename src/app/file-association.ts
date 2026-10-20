import { isTauri } from '../platform/detect';
import { listenForFileOpen } from '../platform/file-open';
import { isMarkdownPath } from '../platform/paths';
import type { ErrorReporter } from './error-reporter';
import { notMarkdownMessage, OPEN_FAILED_TITLE } from './open-failure';

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
 * **A file that is not a markdown document is said, not opened** (#636).
 * The process hands over every path it is given, and this is where the rule
 * of `isMarkdownPath` is asked, the one the files panel follows. A refused
 * path reaches the dialog the other refusals of an open use, and nothing
 * is read and nothing replaced: the gate is not asked, since no document
 * leaves the window.
 *
 * No-op in the web build — File System Access API doesn't surface CLI
 * args or OS file associations.
 */
export function setupFileAssociation(
  openFilePath: (path: string) => Promise<void>,
  reporter: ErrorReporter,
): void {
  if (!isTauri) return;

  const open = (path: string): void => {
    if (!isMarkdownPath(path)) {
      void reporter.dialog(notMarkdownMessage(path), null, OPEN_FAILED_TITLE, 'omit');
      return;
    }
    void openFilePath(path).catch(console.error);
  };
  void listenForFileOpen(open).catch(console.error);
}
