import { startCoordination } from './window-coordination';

/**
 * The document the OS or the command line asks the desktop build to open
 * (R-C11), handed to `open` as a path.
 *
 * The Rust side holds a path that arrives before the page listens, and
 * hands it over when asked (`src-tauri/src/file_open.rs`, #541). So the
 * order here is the whole mechanism: the listeners are installed first and
 * the held path asked for second. A path arriving between the two is still
 * held, since Rust emits nothing until it has been asked, and one arriving
 * after reaches the listener. Asked the other way round, a path offered in
 * between would be emitted to nobody.
 *
 * **Both listeners are this window's own** (#559). On macOS one AgentEd
 * holds several windows, and a document is sent to the one window that is
 * to open it; a listener for every window's events would open it in all of
 * them. The second listener hears the process say this window is one of
 * several, which macOS sends in answer to the ask, so it is installed before
 * the ask too.
 */
export async function listenForFileOpen(open: (path: string) => void): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const own = getCurrentWebviewWindow();
  await own.listen<string>('file-open', (event) => {
    open(event.payload);
  });
  await own.listen('window-coordination', () => {
    startCoordination();
  });
  const held = await invoke<string | null>('take_pending_file_open');
  if (held) open(held);
}
