/**
 * #627 - on a Mac every chord of ours answers Command alone; on Windows and
 * Linux it answers Ctrl or Command, as before.
 *
 * Measured on a macOS runner on the step zero of #627: our listeners took
 * Ctrl, Command and both together, so Ctrl+F, Ctrl+K, Ctrl+O and Ctrl+H, the
 * text bindings of a Mac field, opened Find, the link dialog, the open panel
 * and Replace, Ctrl+Command+F opened Find instead of full screen, and a click
 * with Ctrl, the context menu of a Mac, was taken for the follow gesture. The
 * answer is `isModHeld` in `ui/chord-label.ts`, beside `modIsCommand`, which
 * the labels and ProseMirror read too.
 *
 * Each listener is run on both answers of `modIsCommand`, by the `command`
 * argument the module passes: a row per chord and per modifier, so a chord
 * that answers otherwise names itself. What the system then does with the
 * key on a Mac is not observable here; the runner measured it on the head.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';

const mac = vi.hoisted(() => ({ command: false }));

vi.mock('../ui/chord-label', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/chord-label')>();
  return {
    ...actual,
    isModHeld: (event: { ctrlKey: boolean; metaKey: boolean }) =>
      actual.isModHeld(event, mac.command),
  };
});
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

import { isPlainPasteShortcut } from '../editor/paste';
import { createEditor, type EditorInstance } from '../editor/setup';
import { setupSearchPanel } from '../ui/search-panel';
import { type KeyboardHandlers, setupKeyboard } from './keyboard';
import { installLinkOpener } from './link-open';
import { createSearchManager, type SearchManager } from './search-manager';

// The real answer, for the rows that hand it each platform themselves.
const { isModHeld } =
  await vi.importActual<typeof import('../ui/chord-label')>('../ui/chord-label');

const MODIFIERS = [
  { name: 'Ctrl', ctrlKey: true, metaKey: false },
  { name: 'Cmd', ctrlKey: false, metaKey: true },
  { name: 'Ctrl+Cmd', ctrlKey: true, metaKey: true },
] as const;

/** What each platform answers: Command alone on a Mac, any of the three elsewhere. */
const PLATFORMS = [
  { name: 'a Mac', command: true, answers: (m: string) => m === 'Cmd' },
  { name: 'Windows and Linux', command: false, answers: (_m: string) => true },
] as const;

function shippedFragment(from: string, to: string): string {
  const open = shippedPage.indexOf(from);
  const close = shippedPage.indexOf(to, open);
  if (open < 0 || close < 0) throw new Error(`index.html no longer has ${from} … ${to}`);
  return shippedPage.slice(open, close + to.length);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped page has no #${id}`);
  return found;
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

// One of each listener for the file: the document listeners have no teardown.
let instance: EditorInstance;
let manager: SearchManager;
const handlers: KeyboardHandlers = {
  onSave: vi.fn(),
  onOpen: vi.fn(),
  onLink: vi.fn(),
  onCodeBlock: vi.fn(),
  onToggleSidebar: vi.fn(),
};
const replaceAll = vi.fn();
const openExternal = vi.fn<(url: string) => Promise<void>>();

beforeAll(() => {
  document.body.innerHTML = [
    shippedFragment('<div id="search-panel"', '<details id="frontmatter-panel"').replace(
      /<details id="frontmatter-panel"$/,
      '',
    ),
    '<div id="editor-host"></div>',
    '<div id="links"><a href="https://example.com">example</a></div>',
    `<div id="panel-b">${shippedFragment('<div id="search-panel"', '<details id="frontmatter-panel"').replace(/<details id="frontmatter-panel"$/, '')}</div>`,
  ].join('');
  instance = createEditor(element('editor-host'));
  instance.setMarkdown('alpha one');
  manager = createSearchManager({ editor: instance.editor, panelRoot: element('search-panel') });
  manager.installKeyboardListeners();
  setupKeyboard(handlers);
  installLinkOpener(element('links'), { openExternal });
  setupSearchPanel(element('panel-b'), {
    onQueryChange: vi.fn(),
    onToggleChange: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onReplaceSingle: vi.fn(),
    onReplaceAll: replaceAll,
    onClose: vi.fn(),
  });
});

/** The replace field of the panel this file set up, apart from the manager's. */
function replaceField(): HTMLInputElement {
  const field = element('panel-b').querySelector<HTMLInputElement>('#search-replace-input');
  if (!field) throw new Error('the panel has no replace field');
  return field;
}

afterAll(() => {
  instance.destroy();
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  openExternal.mockResolvedValue(undefined);
  if (manager.isOpen()) manager.close();
});

describe('isModHeld answers as the keymap does (#627)', () => {
  it.each(PLATFORMS.flatMap((p) => MODIFIERS.map((m) => ({ ...m, platform: p }))))(
    'on $platform.name, $name',
    ({ ctrlKey, metaKey, name, platform }) => {
      expect(isModHeld({ ctrlKey, metaKey }, platform.command)).toBe(platform.answers(name));
    },
  );

  it('on either, no modifier is no chord', () => {
    expect(isModHeld({ ctrlKey: false, metaKey: false }, true)).toBe(false);
    expect(isModHeld({ ctrlKey: false, metaKey: false }, false)).toBe(false);
  });
});

describe.each(PLATFORMS)('the chords of ours on $name', (platform) => {
  beforeEach(() => {
    mac.command = platform.command;
  });

  const GLOBAL = [
    { chord: 'S', init: { key: 's', code: 'KeyS' }, handler: 'onSave' },
    { chord: 'O', init: { key: 'o', code: 'KeyO' }, handler: 'onOpen' },
    { chord: 'K', init: { key: 'k', code: 'KeyK' }, handler: 'onLink' },
    { chord: 'Shift+K', init: { key: 'K', code: 'KeyK', shiftKey: true }, handler: 'onCodeBlock' },
    {
      chord: 'Shift+E',
      init: { key: 'E', code: 'KeyE', shiftKey: true },
      handler: 'onToggleSidebar',
    },
  ] as const;

  it.each(GLOBAL.flatMap((c) => MODIFIERS.map((m) => ({ ...c, ...m }))))(
    '$name+$chord, the global keymap',
    ({ init, handler, ctrlKey, metaKey, name }) => {
      press(document, { ...init, ctrlKey, metaKey });
      expect(handlers[handler]).toHaveBeenCalledTimes(platform.answers(name) ? 1 : 0);
    },
  );

  it.each(
    [
      { chord: 'F', key: 'f' },
      { chord: 'H', key: 'h' },
    ].flatMap((c) => MODIFIERS.map((m) => ({ ...c, ...m }))),
  )('$name+$chord, Find and Replace', ({ key, ctrlKey, metaKey, name }) => {
    press(document, { key, ctrlKey, metaKey });
    expect(manager.isOpen()).toBe(platform.answers(name));
  });

  it.each(MODIFIERS)(
    '$name+Enter in the replace field, Replace All',
    ({ ctrlKey, metaKey, name }) => {
      press(replaceField(), { key: 'Enter', ctrlKey, metaKey });
      expect(replaceAll).toHaveBeenCalledTimes(platform.answers(name) ? 1 : 0);
    },
  );

  it.each(MODIFIERS)('$name+Shift+V, paste as plain text', ({ ctrlKey, metaKey, name }) => {
    const event = new KeyboardEvent('keydown', {
      key: 'V',
      code: 'KeyV',
      shiftKey: true,
      ctrlKey,
      metaKey,
    });
    expect(isPlainPasteShortcut(event)).toBe(platform.answers(name));
  });

  it.each(MODIFIERS)('$name+click on a link, the follow gesture', ({ ctrlKey, metaKey, name }) => {
    const link = element('links').querySelector('a') as HTMLAnchorElement;
    const init = { bubbles: true, cancelable: true, button: 0, ctrlKey, metaKey };
    link.dispatchEvent(new MouseEvent('mousedown', init));
    link.dispatchEvent(new MouseEvent('click', init));
    expect(openExternal).toHaveBeenCalledTimes(platform.answers(name) ? 1 : 0);
  });
});
