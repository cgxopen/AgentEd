/**
 * One window among several, on macOS (#559).
 *
 * There a document opened from Finder reaches the running AgentEd, which
 * opens it in a window of its own, and a quit asks the windows holding
 * unsaved changes one at a time (`src-tauri/src/macos_windows.rs`). For both,
 * the process has to know what each window holds, and when a window's gate
 * answered Cancel. This is the page's half.
 *
 * **Nothing here runs until the process says so.** It sends the
 * `window-coordination` event to a window once that window has asked for its
 * document (`file-open.ts`), and it sends it on macOS alone, so a Windows or
 * Linux page, one window per process, never reports and never calls the two
 * commands, which those builds do not have.
 */

/** What the process needs to know about this window's document. */
export interface WindowReport {
  /** The document name, which becomes the window title the Window menu lists. */
  readonly title: string;
  /** Whether a quit has to ask this window. */
  readonly unsaved: boolean;
  /** An empty Untitled document never edited, which a Finder open may reuse. */
  readonly untouched: boolean;
  /**
   * The colour of the page, `--bg` as the stylesheet resolves it, which the
   * process draws behind the next window it shows (#645,
   * `src-tauri/src/window_background.rs`).
   */
  readonly background: string;
}

let coordinated = false;
const starters: Array<() => void> = [];

/** The process has said this window is one of several. */
export function startCoordination(): void {
  if (coordinated) return;
  coordinated = true;
  for (const start of starters) start();
}

/** Run `start` once this window is coordinated, at once if it already is. */
export function onCoordinated(start: () => void): void {
  if (coordinated) start();
  else starters.push(start);
}

/** Tell the process what this window holds. Does nothing until coordinated. */
export async function reportWindowState(report: WindowReport): Promise<void> {
  if (!coordinated) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('report_window_state', { ...report });
}

/**
 * Tell the process this window's gate kept it open, so a quit asking one
 * window at a time stops here. Does nothing until coordinated.
 *
 * If this never arrives, the quit is not stuck: the next quit asks this same
 * window again rather than the next one (`document_windows.rs`).
 */
export async function reportCloseCancelled(): Promise<void> {
  if (!coordinated) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('window_close_cancelled');
}
