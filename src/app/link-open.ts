import { isSingleUrl } from '../editor/link-url';

/**
 * Ctrl/Cmd+click follows a link; a plain click places the caret (#25).
 *
 * Three things have to be true at once, and each is a separate mechanism:
 *
 *  1. **The editing surface never navigates.** A click on a link inside a
 *     document being edited must not take the WebView anywhere — least of all
 *     to a relative path that would leave the app on a blank page. The
 *     anchor's own default action is cancelled for every link click, modifier
 *     or not. Cancelling the *click* does not disturb caret placement, which
 *     the browser already did on mousedown.
 *  2. **The modifier click is taken before ProseMirror sees it.**
 *     prosemirror-view treats Ctrl+click (Cmd on macOS) as "select the clicked
 *     node" — `selectNodeModifier` in its own mousedown listener — which is
 *     what turned a Ctrl+click into a selected paragraph. That happens at
 *     mousedown, so cancelling the click afterwards is too late; the gesture
 *     is intercepted in the capture phase instead, before the event reaches
 *     the editor's DOM.
 *  3. **Only followable addresses are claimed.** `http`, `https` and `mailto`.
 *     A document may hold any href — a relative path to a neighbouring file,
 *     something a converter left behind — and handing an arbitrary string to
 *     the OS opener is not a thing to do on a click. Those links keep the
 *     editor's ordinary behavior; they simply never navigate.
 */
export interface LinkOpenerOptions {
  /** Hand the URL to the OS (Tauri) — rejects on the web build. */
  openExternal: (url: string) => Promise<void>;
}

/** The href under the pointer, or null when the click missed every link. */
function linkAt(event: MouseEvent): string | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const href = target.closest('a[href]')?.getAttribute('href');
  return href === undefined || href === '' ? null : href;
}

/** Ctrl/Cmd + primary button — the "follow this" gesture. */
function isFollowGesture(event: MouseEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.button === 0;
}

export function installLinkOpener(root: HTMLElement, options: LinkOpenerOptions): () => void {
  function onMouseDown(event: MouseEvent): void {
    if (!isFollowGesture(event)) return;
    const href = linkAt(event);
    if (href === null || !isSingleUrl(href)) return;
    // Claimed here so prosemirror-view's mousedown never runs and no node
    // selection is made. stopPropagation is the point; preventDefault keeps
    // the WebView from starting a drag or a navigation of its own.
    event.preventDefault();
    event.stopPropagation();
  }

  function onClick(event: MouseEvent): void {
    const href = linkAt(event);
    if (href === null) return;

    // No link click navigates the editing surface, whatever it points at.
    event.preventDefault();

    if (!isFollowGesture(event) || !isSingleUrl(href)) return;

    void options.openExternal(href).catch((error) => {
      // The web build has no OS opener; a new tab is the equivalent there.
      console.warn('[agented] opening the link through the platform failed:', error);
      window.open(href, '_blank', 'noopener,noreferrer');
    });
  }

  root.addEventListener('mousedown', onMouseDown, true);
  root.addEventListener('click', onClick);
  return () => {
    root.removeEventListener('mousedown', onMouseDown, true);
    root.removeEventListener('click', onClick);
  };
}
