import { BUILD_INFO, type BuildInfo, describeBuildInfo, formatBuildInfo } from '../app/build-info';
import { copyText } from './clipboard';
import { showConfirmDialog } from './confirm-dialog';
import { showToast } from './toast';

/**
 * About AgentEd — version and build commit, two clicks from anywhere
 * (hamburger → About) and one click to copy into a bug report (#31).
 *
 * Built on `showConfirmDialog` rather than as a dialog of its own: the focus
 * handling, Escape, Tab trap and styling already exist there, and an About box
 * has nothing to add to them.
 */
export async function showAboutDialog(info: BuildInfo = BUILD_INFO): Promise<void> {
  const summary = formatBuildInfo(info);
  const choice = await showConfirmDialog({
    title: 'About AgentEd',
    message: `${describeBuildInfo(info)}\n\nWYSIWYG markdown editor — plain files, offline, no account.`,
    actions: [
      { label: 'Copy', value: 'copy', variant: 'primary' },
      { label: 'Close', value: 'close' },
    ],
    defaultAction: 'close',
  });

  if (choice !== 'copy') return;

  const copied = await copyText(summary);
  showToast(
    copied
      ? `Copied: ${summary}`
      : `Could not copy — this build is ${summary}. Open About again to select the text.`,
    copied ? 'info' : 'warn',
  );
}
