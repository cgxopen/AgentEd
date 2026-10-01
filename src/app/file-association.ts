import { isTauri } from '../platform/detect';

/**
 * Listen for the Rust backend's `file-open` event, emitted once, at cold
 * start, when AgentEd was launched with a file path. There is no
 * single-instance hand-off: every launch is its own window (R-C8).
 * No-op in the web build — File System Access API doesn't surface CLI
 * args or OS file associations.
 */
export function setupFileAssociation(openFilePath: (path: string) => Promise<void>): void {
  if (!isTauri) return;

  void import('@tauri-apps/api/event')
    .then(({ listen }) => {
      void listen<string>('file-open', (event) => {
        void openFilePath(event.payload).catch(console.error);
      }).catch(console.error);
    })
    .catch(console.error);
}
