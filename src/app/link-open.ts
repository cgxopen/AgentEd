import { isSingleUrl } from '../editor/link-url';

/**
 * Ctrl/Cmd+click follows a link; a plain click places the caret (#25).
 *
 * The desktop-editor convention, and the reason the Link extension keeps
 * `openOnClick: false`: inside a document you are editing, clicking a link has
 * to be safe. Once links can be *made* from the UI, though, being unable to
 * follow one is its own surprise — so the modifier opens it.
 *
 * Only `http`, `https` and `mailto` are followed. A document may hold any href
 * — a relative path to a neighbouring file, something a stray converter left
 * behind — and handing an arbitrary string to the OS opener is not a thing to
 * do on a click.
 */
export interface LinkOpenerOptions {
  /** Hand the URL to the OS (Tauri) — rejects on the web build. */
  openExternal: (url: string) => Promise<void>;
}

export function installLinkOpener(root: HTMLElement, options: LinkOpenerOptions): () => void {
  function onClick(event: MouseEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest('a[href]');
    const href = anchor?.getAttribute('href') ?? '';
    if (!isSingleUrl(href)) return;

    event.preventDefault();
    void options.openExternal(href).catch((error) => {
      // The web build has no OS opener; a new tab is the equivalent there.
      console.warn('[agented] opening the link through the platform failed:', error);
      window.open(href, '_blank', 'noopener,noreferrer');
    });
  }

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
