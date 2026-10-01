import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import scopeCases from '../../src-tauri/shell-open-cases.json?raw';
import { WebIO } from '../platform/web';
import { showToast } from '../ui/toast';
import { installLinkOpener } from './link-open';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * The links of the shell scope cases (#448): what a Ctrl+click on each
 * spelling must hand to the shell. `src-tauri/src/shell_scope.rs` asserts the
 * scope admits every `handed` string, so the two tests together say the
 * spelling opens.
 */
const LINKS: ReadonlyArray<{ spelling: string; handed: string }> = JSON.parse(scopeCases).links;

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
  vi.mocked(showToast).mockClear();
});

describe('Ctrl/Cmd+click follows a link', () => {
  it('opens the address through the platform on Ctrl+click', () => {
    const event = click(anchor('https://example.com'), { ctrlKey: true });

    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
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

    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
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
/**
 * F1 of the #20 readings (#448): `link-url.ts` reads an address through the
 * URL parser, which folds the scheme and repairs the slashes, while the shell
 * scope matches the raw string. Handing the shell the raw spelling opened
 * nothing for seven of these.
 */
describe('the shell is handed the address the URL parser read', () => {
  it.each(LINKS.map((link) => [JSON.stringify(link.spelling), link]))('%s', (_label, {
    spelling,
    handed,
  }) => {
    click(anchor(spelling), { ctrlKey: true });
    expect(openExternal).toHaveBeenCalledWith(handed);
  });
});

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

describe('an open that fails says so (#448)', () => {
  it('shows a message rather than nothing, and opens no tab behind it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal.mockRejectedValue(new Error('failed regex validation'));

    click(anchor('https://example.com/a'), { ctrlKey: true });

    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('example.com'), 'error');
    expect(openSpy).not.toHaveBeenCalled();
  });
});

/**
 * The new tab of the web build, with `WebIO` itself as the opener (#146).
 *
 * #146 found that a stub which rejects on request pins nothing of the web
 * build: making `WebIO.openWithSystem` resolve left the suite green. That is
 * why this wires the real implementation into `openExternal`, as `main.ts`
 * does. #448 moved the tab from the opener into `WebIO`, so a rejection in the
 * opener now means a failure the person is told about; what stays load-bearing
 * is that the web build opens the tab, and these say so.
 */
describe('#146, #448: the web build opens a new tab itself', () => {
  it('a Ctrl+click opens a new tab when the web build is the opener, and says nothing', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

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
    expect(openSpy).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    expect(showToast).not.toHaveBeenCalled();

    stop();
    ownRoot.remove();
  });

  it('and the web implementation refuses what is not a web address', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(new WebIO().openWithSystem('/proj/notes/assets/x.png')).rejects.toBeInstanceOf(
      Error,
    );
    expect(openSpy).not.toHaveBeenCalled();
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
