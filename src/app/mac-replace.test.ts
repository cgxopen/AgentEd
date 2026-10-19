/**
 * #630 - on a Mac Replace takes Option+Cmd+F and leaves Cmd+H to Hide, and the
 * footnote takes Option+Cmd+N; Windows and Linux keep Ctrl+H and Ctrl+Alt+F
 * (owner decision of 2026-10-19, route a of the step zero).
 *
 * Measured on a macOS runner on the step zero: Find and Replace is
 * Option+Cmd+F in TextEdit, Script Editor and Xcode, and Cmd+H hides AgentEd
 * once the page leaves it. What the system does with Cmd+H is not observable
 * here; the runner measured it on the head. These rows hold what the page
 * binds and what its labels say, on both answers of `modIsCommand`.
 *
 * **The keymap of the harness reads `Mod` as Ctrl**: `prosemirror-keymap`
 * decides it from `navigator.platform` when it loads, and the harness is not a
 * Mac. So the footnote rows of a Mac press the Mac binding, `Mod-Alt-n`, with
 * Ctrl; that `Mod` is Command on a Mac is ProseMirror's, and the runner
 * pressed it with Command.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';

const mac = vi.hoisted(() => ({ command: false }));

vi.mock('../ui/chord-label', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/chord-label')>();
  return {
    ...actual,
    modIsCommand: () => mac.command,
    isModHeld: (event: { ctrlKey: boolean; metaKey: boolean }) =>
      actual.isModHeld(event, mac.command),
  };
});
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

import { createEditor, type EditorInstance } from '../editor/setup';
import { createSearchManager, type SearchManager } from './search-manager';

const { chordAria, chordLabel } =
  await vi.importActual<typeof import('../ui/chord-label')>('../ui/chord-label');

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

function press(init: KeyboardEventInit): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  );
}

describe('Replace and Find (#630)', () => {
  // One manager for the file: its keyboard listener has no teardown.
  let instance: EditorInstance;
  let manager: SearchManager;

  beforeAll(() => {
    document.body.innerHTML = [
      shippedFragment('<div id="search-panel"', '<details id="frontmatter-panel"').replace(
        /<details id="frontmatter-panel"$/,
        '',
      ),
      '<div id="editor-host"></div>',
    ].join('');
    instance = createEditor(element('editor-host'));
    instance.setMarkdown('alpha one');
    manager = createSearchManager({ editor: instance.editor, panelRoot: element('search-panel') });
    manager.installKeyboardListeners();
  });

  beforeEach(() => {
    if (manager.isOpen()) manager.close();
  });

  /** The panel and its mode after a chord: closed, find or replace. */
  function modeAfter(init: KeyboardEventInit): string {
    press(init);
    return manager.isOpen() ? manager.panel.mode() : 'closed';
  }

  // Option with F reports another character on a Mac; the physical key is F.
  const MAC = [
    {
      chord: 'Cmd+Option+F',
      init: { key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true },
      mode: 'replace',
    },
    { chord: 'Cmd+H', init: { key: 'h', code: 'KeyH', metaKey: true }, mode: 'closed' },
    { chord: 'Cmd+F', init: { key: 'f', code: 'KeyF', metaKey: true }, mode: 'find' },
  ] as const;
  const ELSEWHERE = [
    { chord: 'Ctrl+H', init: { key: 'h', code: 'KeyH', ctrlKey: true }, mode: 'replace' },
    {
      chord: 'Ctrl+Alt+F',
      init: { key: 'f', code: 'KeyF', ctrlKey: true, altKey: true },
      mode: 'closed',
    },
    { chord: 'Ctrl+F', init: { key: 'f', code: 'KeyF', ctrlKey: true }, mode: 'find' },
  ] as const;

  it.each(MAC)('on a Mac, $chord: $mode', ({ init, mode }) => {
    mac.command = true;
    expect(modeAfter(init)).toBe(mode);
  });

  it.each(ELSEWHERE)('on Windows and Linux, $chord: $mode', ({ init, mode }) => {
    mac.command = false;
    expect(modeAfter(init)).toBe(mode);
  });
});

describe('the footnote chord (#630)', () => {
  let instance: EditorInstance | null = null;

  afterEach(() => {
    instance?.destroy();
    instance = null;
    document.body.innerHTML = '';
  });

  /** Whether the chord, pressed in an editor built for the platform, made a footnote. */
  function footnoteFrom(command: boolean, init: KeyboardEventInit): boolean {
    mac.command = command;
    const host = document.createElement('div');
    document.body.appendChild(host);
    instance = createEditor(host);
    instance.setMarkdown('alpha');
    instance.editor.commands.setTextSelection(3);
    const { view } = instance.editor;
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    view.someProp('handleKeyDown', (handler) => handler(view, event));
    return instance.getMarkdown().includes('[^1]');
  }

  it.each([
    { chord: 'Option+Cmd+N, its binding pressed with Ctrl', key: 'n', code: 'KeyN', made: true },
    { chord: 'Option+Cmd+F, its binding pressed with Ctrl', key: 'f', code: 'KeyF', made: false },
  ])('on a Mac, $chord: $made', ({ key, code, made }) => {
    expect(footnoteFrom(true, { key, code, ctrlKey: true, altKey: true })).toBe(made);
  });

  it.each([
    { chord: 'Ctrl+Alt+F', key: 'f', code: 'KeyF', made: true },
    { chord: 'Ctrl+Alt+N', key: 'n', code: 'KeyN', made: false },
  ])('on Windows and Linux, $chord: $made', ({ key, code, made }) => {
    expect(footnoteFrom(false, { key, code, ctrlKey: true, altKey: true })).toBe(made);
  });
});

describe('the labels say the chord each platform binds (#630)', () => {
  it.each([
    { windows: 'Ctrl+H', mac: 'Cmd+Option+F' },
    { windows: 'Ctrl+Alt+F', mac: 'Cmd+Option+N' },
    { windows: 'Footnote (Ctrl+Alt+F)', mac: 'Footnote (Cmd+Option+N)' },
    { windows: 'Ctrl+Shift+H', mac: 'Cmd+Shift+H' },
  ])('$windows', ({ windows, mac: onMac }) => {
    expect(chordLabel(windows, false)).toBe(windows);
    expect(chordLabel(windows, true)).toBe(onMac);
  });

  it.each([
    { windows: 'Control+H', mac: 'Meta+Alt+F' },
    { windows: 'Control+Alt+F', mac: 'Meta+Alt+N' },
  ])('aria-keyshortcuts $windows', ({ windows, mac: onMac }) => {
    expect(chordAria(windows, false)).toBe(windows);
    expect(chordAria(windows, true)).toBe(onMac);
  });
});
