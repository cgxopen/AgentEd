import { BUILD_INFO, type BuildInfo, describeBuildInfo, formatBuildInfo } from '../app/build-info';
import { thirdPartyNoticesFile } from '../platform';
import { copyText } from './clipboard';
import { showConfirmDialog } from './confirm-dialog';
import { showToast } from './toast';

/**
 * About AgentEd — version and build commit, two clicks from anywhere
 * (hamburger → About) and one click to copy into a bug report (Q5, #31).
 *
 * Q5 also says what this dialog must *not* grow into: it states the build to
 * the user and sends nothing anywhere. No update check, no report button.
 *
 * Built on `showConfirmDialog` rather than as a dialog of its own: the focus
 * handling, Escape, Tab trap and styling already exist there, and an About box
 * has nothing to add to them.
 *
 * It also names the third-party notices file the installer put beside the
 * application (#475), on the build that has one.
 */
export async function showAboutDialog(
  info: BuildInfo = BUILD_INFO,
  notices: string | null = thirdPartyNoticesFile(),
): Promise<void> {
  const summary = formatBuildInfo(info);
  const noticesLine = notices ? `\n\nThird-party notices: ${notices} in the install folder.` : '';
  const choice = await showConfirmDialog({
    title: 'About AgentEd',
    message: `${describeBuildInfo(info)}\n\nWYSIWYG markdown editor — plain files, offline, no account.${noticesLine}`,
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
