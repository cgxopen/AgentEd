/**
 * Paste and Match Style chosen from the macOS Edit menu (#558).
 *
 * The item sends WebKit's plain paste, which reaches the editor as an ordinary
 * paste event; the editor reads it as plain text only when one was asked for
 * (`editor/paste.ts`). The chord asks for it on its keydown. The item chosen
 * with the pointer has no keydown, so the process tells this window first
 * (`src-tauri/src/macos_paste.rs`), and this listener asks. Only macOS sends
 * the event.
 */
export async function listenForPlainPasteRequest(request: () => void): Promise<void> {
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  await getCurrentWebviewWindow().listen('paste-as-plain-text', () => {
    request();
  });
}
