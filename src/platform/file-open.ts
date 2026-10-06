/**
 * The document the OS or the command line asks the desktop build to open
 * (R-C11), handed to `open` as a path.
 *
 * The Rust side holds a path that arrives before the page listens, and
 * hands it over when asked (`src-tauri/src/file_open.rs`, #541). So the
 * order here is the whole mechanism: the `file-open` listener is installed
 * first and the held path asked for second. A path arriving between the
 * two is still held, since Rust emits nothing until it has been asked, and
 * one arriving after reaches the listener. Asked the other way round, a
 * path offered in between would be emitted to nobody.
 */
export async function listenForFileOpen(open: (path: string) => void): Promise<void> {
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');
  await listen<string>('file-open', (event) => {
    open(event.payload);
  });
  const held = await invoke<string | null>('take_pending_file_open');
  if (held) open(held);
}
