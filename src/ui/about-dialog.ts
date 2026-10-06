import { BUILD_INFO, type BuildInfo, describeBuildInfo, formatBuildInfo } from '../app/build-info';
import { openThirdPartyNotices, thirdPartyNoticesFile } from '../platform';
import { copyText } from './clipboard';
import { showConfirmDialog } from './confirm-dialog';
import { showToast } from './toast';

/** The label of the control that opens the notices (#549). */
export const NOTICES_LABEL = 'Third-party notices';

export const NOTICES_MISSING_MESSAGE =
  'Could not open the third-party notices: the file is not in the folder AgentEd is installed in.';
export const NOTICES_FAILED_MESSAGE =
  'Could not open the third-party notices: the system did not open the file.';

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
 * On a build that installs third-party notices (#475) it offers to open them
 * with the default application of the system (#549), rather than saying where
 * the file is: on macOS it sits inside the `.app`, where Finder does not look.
 */
export async function showAboutDialog(
  info: BuildInfo = BUILD_INFO,
  notices: string | null = thirdPartyNoticesFile(),
  openNotices: () => Promise<'opened' | 'missing' | 'none'> = openThirdPartyNotices,
): Promise<void> {
  const summary = formatBuildInfo(info);
  const noticesLine = notices
    ? '\n\nAgentEd includes software by others, under their own licences.'
    : '';
  const choice = await showConfirmDialog({
    title: 'About AgentEd',
    message: `${describeBuildInfo(info)}\n\nWYSIWYG markdown editor — plain files, offline, no account.${noticesLine}`,
    actions: [
      { label: 'Copy', value: 'copy', variant: 'primary' },
      ...(notices ? [{ label: NOTICES_LABEL, value: 'notices' as const }] : []),
      { label: 'Close', value: 'close' },
    ],
    defaultAction: 'close',
  });

  if (choice === 'notices') {
    await openNoticesAndReport(openNotices);
    return;
  }
  if (choice !== 'copy') return;

  const copied = await copyText(summary);
  showToast(
    copied
      ? `Copied: ${summary}`
      : `Could not copy — this build is ${summary}. Open About again to select the text.`,
    copied ? 'info' : 'warn',
  );
}

/**
 * Open the notices and say so when that fails. Nothing is said on success:
 * the file opening in another window is the answer.
 */
async function openNoticesAndReport(
  openNotices: () => Promise<'opened' | 'missing' | 'none'>,
): Promise<void> {
  try {
    if ((await openNotices()) === 'missing') showToast(NOTICES_MISSING_MESSAGE, 'warn');
  } catch (e) {
    console.error('[about] opening the third-party notices failed:', e);
    showToast(NOTICES_FAILED_MESSAGE, 'warn');
  }
}
