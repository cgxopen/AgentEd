import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { installLinkOpener } from './link-open';

let root: HTMLElement;
let openExternal: Mock<(url: string) => Promise<void>>;
let uninstall: () => void;

function anchor(href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
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
});

describe('a plain click is left alone', () => {
  it('places the caret rather than opening anything', () => {
    const event = click(anchor('https://example.com'));

    expect(openExternal).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores a Ctrl+click that is not on a link', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'no link here';
    root.appendChild(paragraph);

    click(paragraph, { ctrlKey: true });

    expect(openExternal).not.toHaveBeenCalled();
  });
});

// A document can hold any href — a relative path to a neighbouring file, or
// something a converter left behind. Handing an arbitrary string to the OS
// opener is not a thing to do on a click.
describe('only allow-listed schemes are followed', () => {
  it.each([
    ['a relative path', './notes.md'],
    ['an absolute path', '/etc/passwd'],
    ['a script URL', 'javascript:alert(1)'],
    ['a file URL', 'file:///etc/passwd'],
    ['an anchor', '#section'],
  ])('ignores %s', (_label, href) => {
    const event = click(anchor(href), { ctrlKey: true });

    expect(openExternal).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('follows mailto, which is a link a reader means to use', () => {
    click(anchor('mailto:hi@example.com'), { ctrlKey: true });
    expect(openExternal).toHaveBeenCalledWith('mailto:hi@example.com');
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

describe('teardown', () => {
  it('stops listening once uninstalled', () => {
    uninstall();
    click(anchor('https://example.com'), { ctrlKey: true });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
