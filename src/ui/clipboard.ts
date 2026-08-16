/**
 * Copy text to the system clipboard.
 *
 * `navigator.clipboard` is a WebView API, identical on the desktop build and
 * on the web one, so this does not belong behind the platform layer — there is
 * no Tauri call here to abstract. Writing is the permissive half of the
 * clipboard API (reading is what needs permission), but it can still be
 * refused: an insecure context, or a WebView that denies it. Callers get a
 * boolean rather than an exception, because "the copy did not happen" is a
 * thing to tell the user, not an error to swallow.
 */
export async function copyText(text: string): Promise<boolean> {
  if (text === '') return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.warn('[agented] clipboard write refused:', error);
    return false;
  }
}
