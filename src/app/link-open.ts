import { webAddressFor } from '../editor/link-url';
import { reportSystemOpenFailure } from './system-open-failure';

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
 *  3. **The gesture is claimed on every link; only some are followed.** Two
 *     different questions, and the guard must not answer them with one test.
 *     Ctrl+click on a link means "follow this" in this editor, so it may never
 *     fall through to ProseMirror's node selection — not even on a link we
 *     decline to open. What the scheme decides is only whether the address is
 *     handed to the OS: `http`, `https` and `mailto` are, and a relative path
 *     or whatever a converter left behind is not, because handing an arbitrary
 *     string to the shell is not a thing to do on a click. What is handed is
 *     the address as the URL parser read it (#448).
 */
export interface LinkOpenerOptions {
  /** Hand the URL to the OS, or to a new tab on the web build. */
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
    // Any link, whatever it points at: the scheme decides what happens next,
    // never whether the gesture is ours. Claimed here so prosemirror-view's
    // mousedown never runs and no node selection is made. stopPropagation is
    // the point; preventDefault keeps the WebView from starting a drag or a
    // navigation of its own.
    if (linkAt(event) === null) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onClick(event: MouseEvent): void {
    const href = linkAt(event);
    if (href === null) return;

    // No link click navigates the editing surface, whatever it points at.
    event.preventDefault();

    if (!isFollowGesture(event)) return;
    // The address as the URL parser read it, which is what the allow-list
    // judged, rather than the spelling the document holds (#448).
    const address = webAddressFor(href);
    if (address === null) return;

    // A failure is told to the person rather than to the console alone
    // (#448). On the web the platform opens a new tab itself, so a rejection
    // here is a real failure on either build.
    void options.openExternal(address).catch((error) => reportSystemOpenFailure(address, error));
  }

  root.addEventListener('mousedown', onMouseDown, true);
  root.addEventListener('click', onClick);
  return () => {
    root.removeEventListener('mousedown', onMouseDown, true);
    root.removeEventListener('click', onClick);
  };
}
