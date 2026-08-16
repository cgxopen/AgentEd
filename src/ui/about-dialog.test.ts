import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBuildInfo } from '../app/build-info';
import { showAboutDialog } from './about-dialog';
import { copyText } from './clipboard';
import { showToast } from './toast';

vi.mock('./clipboard', () => ({ copyText: vi.fn().mockResolvedValue(true) }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));

const copyTextMock = vi.mocked(copyText);
const showToastMock = vi.mocked(showToast);

const CI_BUILD = readBuildInfo('0.2.0', 'a1b2c3d');
const LOCAL_BUILD = readBuildInfo('0.2.0', 'dev');

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.dialog-overlay');
  if (!el) throw new Error('the About dialog is not open');
  return el;
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(dialog().querySelectorAll('button')).find(
    (b) => b.textContent === label,
  );
  if (!match) throw new Error(`no "${label}" button in the dialog`);
  return match;
}

afterEach(() => {
  document.querySelector('.dialog-overlay')?.remove();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  copyTextMock.mockResolvedValue(true);
});

describe('showAboutDialog', () => {
  it('shows the version and the build commit', async () => {
    const pending = showAboutDialog(CI_BUILD);
    expect(dialog().textContent).toContain('0.2.0');
    expect(dialog().textContent).toContain('a1b2c3d');
    button('Close').click();
    await pending;
  });

  it('says a local build has no commit rather than showing a wrong one', async () => {
    const pending = showAboutDialog(LOCAL_BUILD);
    const text = dialog().textContent ?? '';
    expect(text).toContain('local development build');
    expect(text).not.toMatch(/Build [0-9a-f]{7}/);
    button('Close').click();
    await pending;
  });

  it('copies a one-line summary fit for a bug report', async () => {
    const pending = showAboutDialog(CI_BUILD);
    button('Copy').click();
    await pending;

    expect(copyTextMock).toHaveBeenCalledWith('AgentEd 0.2.0 (a1b2c3d)');
    expect(showToastMock).toHaveBeenCalledWith('Copied: AgentEd 0.2.0 (a1b2c3d)', 'info');
  });

  it('copies nothing when the dialog is just closed', async () => {
    const pending = showAboutDialog(CI_BUILD);
    button('Close').click();
    await pending;

    expect(copyTextMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('still tells the user the build when the clipboard refuses', async () => {
    copyTextMock.mockResolvedValue(false);
    const pending = showAboutDialog(CI_BUILD);
    button('Copy').click();
    await pending;

    const [message, kind] = showToastMock.mock.calls[0];
    expect(message).toContain('AgentEd 0.2.0 (a1b2c3d)');
    expect(kind).toBe('warn');
  });

  it('closes on Escape without copying', async () => {
    const pending = showAboutDialog(CI_BUILD);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await pending;

    expect(document.querySelector('.dialog-overlay')).toBeNull();
    expect(copyTextMock).not.toHaveBeenCalled();
  });
});
