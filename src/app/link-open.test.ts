import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WebIO } from '../platform/web';
import { installLinkOpener } from './link-open';

let root: HTMLElement;
let openExternal: Mock<(url: string) => Promise<void>>;
let uninstall: () => void;

function anchor(href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  a.textContent = 'the docs';
  root.appendChild(a);
  return a;
}

function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

/**
 * A mousedown that reports whether it reached the editor. prosemirror-view
 * listens on its own DOM node inside `root`, so "reached the editor" is
 * modelled by a listener on the anchor itself: anything that stops
 * propagation in the capture phase above it keeps ProseMirror out.
 */
function mouseDown(
  target: Element,
  init: MouseEventInit = {},
): { event: MouseEvent; reachedEditor: boolean } {
  let reachedEditor = false;
  const spy = () => {
    reachedEditor = true;
  };
  target.addEventListener('mousedown', spy);
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  target.dispatchEvent(event);
  target.removeEventListener('mousedown', spy);
  return { event, reachedEditor };
}

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
  uninstall = installLinkOpener(root, { openExternal });
});

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

describe('Ctrl/Cmd+click follows a link', () => {
  it('opens the address through the platform on Ctrl+click', () => {
    const event = click(anchor('https://example.com'), { ctrlKey: true });

    expect(openExternal).toHaveBeenCalledWith('https://example.com');
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens on Cmd+click too', () => {
    click(anchor('https://example.com'), { metaKey: true });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('opens when the click lands on something inside the link', () => {
    const a = anchor('https://example.com');
    const inner = document.createElement('strong');
    inner.textContent = 'docs';
    a.appendChild(inner);

    click(inner, { ctrlKey: true });

    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('follows mailto, which is a link a reader means to use', () => {
    click(anchor('mailto:hi@example.com'), { ctrlKey: true });
    expect(openExternal).toHaveBeenCalledWith('mailto:hi@example.com');
  });
});

/**
 * The paragraph that came back selected on Windows: prosemirror-view turns
 * Ctrl+click into "select the clicked node" from its own mousedown listener.
 * The gesture has to be taken in the capture phase — by the time the click
 * fires, the selection has already been made.
 */
describe('the modifier click never reaches the editor', () => {
  it('stops the mousedown before ProseMirror can select the node', () => {
    const { event, reachedEditor } = mouseDown(anchor('https://example.com'), { ctrlKey: true });

    expect(reachedEditor).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves an ordinary mousedown alone, so clicking still places the caret', () => {
    const { event, reachedEditor } = mouseDown(anchor('https://example.com'));

    expect(reachedEditor).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  // Two questions, not one: whether the gesture is ours, and whether the
  // address can be handed to the shell. A link we decline to open is still a
  // link, and Ctrl+click on it must not mean "select this paragraph" — the
  // chord has been given another meaning in this editor.
  it.each([
    ['a relative path', './notes.md'],
    ['an absolute path', '/etc/passwd'],
    ['a script URL', 'javascript:alert(1)'],
    ['a file URL', 'file:///etc/passwd'],
    ['an anchor', '#section'],
  ])('claims the gesture on %s too, even though it will not follow it', (_label, href) => {
    const { event, reachedEditor } = mouseDown(anchor(href), { ctrlKey: true });

    expect(reachedEditor).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('leaves a mousedown that missed every link to the editor', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'no link here';
    root.appendChild(paragraph);

    const { reachedEditor } = mouseDown(paragraph, { ctrlKey: true });

    expect(reachedEditor).toBe(true);
  });
});

/**
 * A document being edited must not navigate away — least of all to a relative
 * path, which would leave the app on a blank page. Cancelling the click does
 * not disturb the caret: the browser placed it at mousedown.
 */
describe('a link click never navigates the editing surface', () => {
  it('cancels the anchor default on a plain click, and opens nothing', () => {
    const event = click(anchor('https://example.com'));

    expect(openExternal).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['a relative path', './notes.md'],
    ['an absolute path', '/etc/passwd'],
    ['a script URL', 'javascript:alert(1)'],
    ['a file URL', 'file:///etc/passwd'],
    ['an anchor', '#section'],
  ])('cancels the default for %s without following it', (_label, href) => {
    const event = click(anchor(href), { ctrlKey: true });

    expect(openExternal).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a click that is not on a link at all', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'no link here';
    root.appendChild(paragraph);

    const event = click(paragraph, { ctrlKey: true });

    expect(openExternal).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('when the platform cannot open it', () => {
  it('falls back to a new tab instead of losing the click', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    openExternal.mockRejectedValue(new Error('not supported on the web platform'));

    click(anchor('https://example.com'), { ctrlKey: true });
    await vi.waitFor(() => expect(openSpy).toHaveBeenCalled());

    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
  });
});

/**
 * The same fallback, with the rejection coming from `WebIO` itself (#146).
 *
 * **The test above satisfies the criterion this replaces and pins
 * nothing of the thing it is for.** Its rejection comes from
 * `openExternal.mockRejectedValue`, so it asserts what happens *given* a
 * rejection; nothing asserted that the web build produces one. Measured
 * on this branch: making `WebIO.openWithSystem` resolve instead of throw
 * left the whole suite green — 84 files, 1815 tests — with that test
 * among them. The repair this issue warns about would have shipped
 * behind a green run.
 *
 * So this one wires the real implementation into `openExternal`, exactly
 * as `main.ts` does. The throw in `web.ts` is load-bearing and this is
 * what says so.
 */
describe('#146 — the rejection comes from WebIO, not from a stub', () => {
  it('a Ctrl+click still opens a new tab when the web build is the opener', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const web = new WebIO();
    const ownRoot = document.createElement('div');
    document.body.appendChild(ownRoot);
    const stop = installLinkOpener(ownRoot, {
      openExternal: (url) => web.openWithSystem(url),
    });

    const a = document.createElement('a');
    a.setAttribute('href', 'https://example.com');
    a.textContent = 'the docs';
    ownRoot.appendChild(a);
    a.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }),
    );

    await vi.waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');

    stop();
    ownRoot.remove();
  });

  it('and the implementation rejects, which is the half the fallback needs', async () => {
    // Stated separately so a failure says which half moved: the platform
    // stopped refusing, or the opener stopped falling back.
    await expect(new WebIO().openWithSystem('https://example.com')).rejects.toBeInstanceOf(Error);
  });
});

describe('teardown', () => {
  it('stops listening once uninstalled', () => {
    uninstall();
    const a = anchor('https://example.com');
    const { reachedEditor } = mouseDown(a, { ctrlKey: true });
    const event = click(a, { ctrlKey: true });

    expect(openExternal).not.toHaveBeenCalled();
    expect(reachedEditor).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });
});

// The other half of the fix lives in the editor config: the anchors carry no
// target, so the WebView has no new-window request to hand to the shell.
describe('the editor renders links without a target', () => {
  it('is asserted where the extension is configured', async () => {
    const { createEditor } = await import('../editor/setup');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const instance = createEditor(host);
    instance.setMarkdown('[docs](https://example.com)');

    const html = instance.editor.getHTML();
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('target=');

    instance.destroy();
  });
});
