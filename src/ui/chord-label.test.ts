/**
 * #558 - the chords AgentEd names, spelled for the key the editor keymap binds.
 *
 * **Said first: a tooltip on screen is not observable here**, and neither is
 * which key a Mac keyboard sends. What these rows hold is that the label and
 * the binding answer the same question the same way - the keymap itself is
 * asked, on each kind of `navigator.platform` - and that every chord the shipped
 * page names is respelled, and only on a Mac. The keys themselves were measured
 * on a macOS runner on the step zero of #558.
 */
import { keydownHandler } from '@tiptap/pm/keymap';
import { describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import keymapSource from '../../node_modules/prosemirror-keymap/dist/index.js?raw';
import { applyChordLabels, chordAria, chordLabel, modIsCommand } from './chord-label';

describe('the label asks what the keymap asks (#558)', () => {
  // The keymap decides once, when it loads, and a module of `node_modules` is
  // not loaded again under another `navigator.platform` in this harness. So the
  // expression is read out of its source, which a release that changed it
  // reddens, and the behaviour is held on the platform the harness has.
  it('uses the expression prosemirror-keymap reads Mod by', () => {
    expect(keymapSource).toContain('/Mac|iP(hone|[oa]d)/.test(navigator.platform)');
    for (const platform of ['MacIntel', 'iPhone', 'iPad'])
      expect(modIsCommand(platform)).toBe(true);
    for (const platform of ['Win32', 'Linux x86_64', ''])
      expect(modIsCommand(platform)).toBe(false);
    expect(modIsCommand(undefined)).toBe(false);
  });

  it('and agrees with the keymap here', () => {
    const undo = vi.fn(() => true);
    const handler = keydownHandler({ 'Mod-z': undo });
    handler({} as never, new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    const keymapBindsCommand = undo.mock.calls.length === 1;
    expect(modIsCommand(navigator.platform)).toBe(keymapBindsCommand);
    expect(chordLabel('Ctrl+Z')).toBe(keymapBindsCommand ? 'Cmd+Z' : 'Ctrl+Z');
  });
});

describe('the spelling (owner decision on #558: Cmd written out)', () => {
  it.each([
    ['Ctrl+Z', 'Cmd+Z'],
    ['Ctrl+Shift+K', 'Cmd+Shift+K'],
    ['Ctrl+Alt+1', 'Cmd+Option+1'],
    ['F3', 'Fn+F3'],
    ['Shift+F3', 'Fn+Shift+F3'],
    ['Previous (Shift+Enter, Shift+F3)', 'Previous (Shift+Enter, Fn+Shift+F3)'],
    ['Bold (Ctrl+B)', 'Bold (Cmd+B)'],
  ])('%s reads %s on a Mac, and as written elsewhere', (windows, mac) => {
    expect(chordLabel(windows, true)).toBe(mac);
    expect(chordLabel(windows, false)).toBe(windows);
  });

  it('aria-keyshortcuts names Meta for Command, and nothing else changes', () => {
    expect(chordAria('Control+Alt+1', true)).toBe('Meta+Alt+1');
    expect(chordAria('Shift+F3', true)).toBe('Shift+F3');
    expect(chordAria('Control+Z', false)).toBe('Control+Z');
  });
});

describe('the shipped page (#558)', () => {
  function page(): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = shippedPage.slice(
      shippedPage.indexOf('<body'),
      shippedPage.indexOf('</body>'),
    );
    return root;
  }

  it('reads as written where the keymap binds Ctrl', () => {
    const root = page();
    const before = root.innerHTML;
    applyChordLabels(root, false);
    expect(root.innerHTML).toBe(before);
  });

  it('names no Ctrl on a Mac, and every chord it named is still named', () => {
    const root = page();
    const named = root.querySelectorAll('[aria-keyshortcuts]').length;
    applyChordLabels(root, true);
    expect(named).toBeGreaterThanOrEqual(12);
    expect(root.innerHTML).not.toMatch(/Ctrl\+|Control\+/);
    expect(root.querySelector('#menu-undo')?.getAttribute('title')).toBe('Cmd+Z');
    expect(root.querySelector('#menu-undo')?.getAttribute('aria-keyshortcuts')).toBe('Meta+Z');
    expect(root.querySelector('#menu-find-next')?.getAttribute('title')).toBe('Fn+F3');
    // Two chords are other keys on a Mac (#630): Replace and the footnote.
    expect(root.querySelector('#menu-insert-footnote')?.getAttribute('title')).toBe('Cmd+Option+R');
    expect(root.querySelector('#menu-replace')?.getAttribute('title')).toBe('Cmd+Option+F');
    expect(root.querySelectorAll('[aria-keyshortcuts]').length).toBe(named);
  });
});
