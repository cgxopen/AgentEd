import { getExtensionField } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import readme from '../../README.md?raw';
import { setupKeyboard } from '../app/keyboard';
import { isFindChord, isFindStepChord, isReplaceChord } from '../app/search-manager';
import { isPlainPasteShortcut } from '../editor/paste';
import { createEditor } from '../editor/setup';
import { chordLabel, isModHeld } from '../ui/chord-label';
import { isReplaceAllChord } from '../ui/search-panel';
import guide from './guide.md?raw';
import { guideChords, guideMarkdown, helpMarkdown } from './index';
import { MAC_NOTE, macCell, SHORTCUTS, type Shortcut, shortcutsMarkdown } from './shortcuts';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * The list of keyboard shortcuts is the one source (#701, owner decisions of
 * 2026-11-05): the README table is held equal to it, and it is held to the
 * keymap in both directions.
 */

/** The rows of the Keyboard shortcuts table of README.md, cell by cell. */
function readmeRows(): string[][] {
  const start = readme.indexOf('## Keyboard shortcuts');
  const block = readme.slice(start, readme.indexOf('\n## ', start + 1));
  return block
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Windows'))
    .map((line) => line.slice(2, -2).split(' | '));
}

/** The chords of a cell: each code span; a range gives both of its ends. */
function chordsOf(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/**
 * Chords no keymap of ours answers, by their nature: the system clipboard
 * chords, which the web view runs, and the click that follows a link, which
 * is a pointer gesture (`app/link-open.ts`).
 */
const NATIVE = new Set(['Ctrl', 'Cmd', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Cmd+C', 'Cmd+X', 'Cmd+V']);

/**
 * A chord as a set of keys, so `Ctrl+Shift+Z`, `Mod-Shift-z` and
 * `Shift-Mod-z` compare equal. Ctrl and Cmd are both the keymap `Mod`, and
 * Option is Alt.
 */
function normal(chord: string): string {
  const parts = chord.split(/[+-](?=.)/);
  const key = parts.pop() ?? '';
  const mods = parts.map((p) => ({ Ctrl: 'Mod', Cmd: 'Mod', Option: 'Alt' })[p] ?? p).sort();
  return [...mods, key.length === 1 ? key.toLowerCase() : key].join('+');
}

let destroy: (() => void) | null = null;
afterEach(() => {
  destroy?.();
  destroy = null;
  vi.restoreAllMocks();
});

/** Every binding of the editor keymap, as ProseMirror names them. */
function editorKeymap(platform: 'Win32' | 'MacIntel' = 'Win32'): string[] {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  const element = document.createElement('div');
  document.body.appendChild(element);
  const instance = createEditor(element);
  destroy = () => instance.destroy();
  const keys: string[] = [];
  for (const ext of instance.editor.extensionManager.extensions) {
    const context = {
      name: ext.name,
      options: ext.options,
      storage: ext.storage,
      editor: instance.editor,
      type: null,
    };
    const shortcuts = getExtensionField(ext, 'addKeyboardShortcuts', context) as
      | (() => object)
      | undefined;
    if (shortcuts) keys.push(...Object.keys(shortcuts()));
  }
  return keys;
}

/** A keydown for the Windows spelling of `chord`. */
function keydown(chord: string): KeyboardEvent {
  const parts = chord.split('+');
  const key = parts[parts.length - 1];
  const letter = key.length === 1;
  return new KeyboardEvent('keydown', {
    key: letter ? (parts.includes('Shift') ? key.toUpperCase() : key.toLowerCase()) : key,
    code: letter ? `Key${key.toUpperCase()}` : key,
    ctrlKey: parts.includes('Ctrl'),
    shiftKey: parts.includes('Shift'),
    altKey: parts.includes('Alt'),
  });
}

/** The chords our own listeners answer, asked of the listeners themselves. */
function answeredByListener(chord: string, row: Shortcut): boolean {
  const event = keydown(chord);
  if (row.field === 'replace') return isReplaceAllChord(event, false);
  if (isFindStepChord(event)) return true;
  if (isModHeld(event, false) && (isFindChord(event) || isReplaceChord(event, false))) return true;
  if (isPlainPasteShortcut(event)) return true;
  const calls: string[] = [];
  const spy = (name: string) => () => calls.push(name);
  const controller = new AbortController();
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) =>
    add(type, listener, {
      ...(typeof options === 'object' ? options : {}),
      signal: controller.signal,
    }),
  );
  setupKeyboard({
    onSave: spy('save'),
    onOpen: spy('open'),
    onLink: spy('link'),
    onCodeBlock: spy('code block'),
    onToggleSidebar: spy('files panel'),
  });
  vi.mocked(document.addEventListener).mockRestore();
  document.dispatchEvent(event);
  controller.abort();
  return calls.length > 0;
}

/**
 * Chords the keymap answers that the list leaves out, each with its reason.
 * The first two are R-C10 decisions; the rest are other spellings of a chord
 * the list names, or editing keys rather than shortcuts.
 */
const LEFT_OUT: Readonly<Record<string, string>> = {
  'Mod-Shift-9': 'Checklist: left unannounced by R-C10, never driven on the shipped target',
  'Mod-Alt-c': 'Code block: named only in R-C10; Ctrl+Shift+K is the chord the menu names',
  'Mod-B': 'Bold, the uppercase spelling of Mod-b',
  'Mod-I': 'Italic, the uppercase spelling of Mod-i',
  'Mod-U': 'Underline, the uppercase spelling of Mod-u',
  'Mod-я': 'Undo on a Cyrillic layout',
  'Shift-Mod-я': 'Redo on a Cyrillic layout',
  'Mod-Backspace': 'Delete backward, as Backspace',
  'Mod-Delete': 'Delete forward, as Delete',
};

/** Every chord the list names, range ends filled in, native chords left out. */
function listedChords(cell: (row: Shortcut) => string): Array<[string, Shortcut]> {
  return SHORTCUTS.flatMap((row) =>
    chordsOf(cell(row)).map((chord): [string, Shortcut] => [chord, row]),
  ).filter(([chord]) => !NATIVE.has(chord));
}

describe('the list of keyboard shortcuts (#701)', () => {
  it('README.md holds the same table, both columns', () => {
    expect(readmeRows()).toEqual(SHORTCUTS.map((row) => [row.win, macCell(row), row.action]));
  });

  it('README.md writes the macOS line the help writes under the table', () => {
    expect(readme).toContain(`\n${MAC_NOTE}\n`);
  });

  it('every chord the list names is answered on Windows, by the keymap or a listener of ours', () => {
    const keymap = new Set(editorKeymap().map(normal));
    const missing = listedChords((row) => row.win)
      .filter(([chord, row]) => (row.field ? true : !keymap.has(normal(chord))))
      .filter(([chord, row]) => !answeredByListener(chord, row))
      .map(([chord]) => chord);
    expect(missing).toEqual([]);
  });

  it('on a Mac, every chord the keymap answers on Windows is answered in its macOS spelling', () => {
    const windows = new Set(editorKeymap().map(normal));
    const mac = new Set(editorKeymap('MacIntel').map(normal));
    const missing = SHORTCUTS.flatMap((row) => {
      const win = chordsOf(row.win);
      const own = chordsOf(macCell(row));
      return win
        .map((chord, i) => [chord, own[i]] as const)
        .filter(([chord]) => !row.field && windows.has(normal(chord)))
        .filter(([, macChord]) => !mac.has(normal(macChord.replace(/^Fn\+/, ''))))
        .map(([, macChord]) => macChord);
    });
    expect(missing).toEqual([]);
  });

  it('every Mod chord the keymap answers is listed or left out by name, on both platforms', () => {
    const listed = new Set(listedChords((row) => row.win).map(([chord]) => normal(chord)));
    for (const n of [2, 3, 4, 5]) listed.add(normal(`Ctrl+Alt+${n}`));
    const left = new Set(Object.keys(LEFT_OUT).map(normal));
    for (const platform of ['Win32', 'MacIntel'] as const) {
      const unnamed = editorKeymap(platform)
        .filter((key) => key.includes('Mod'))
        .filter((key) => !listed.has(normal(key)) && !left.has(normal(key)));
      // The footnote is Mod-Alt-r on a Mac (#630), listed as Ctrl+Alt+F.
      const expected = platform === 'MacIntel' ? ['Mod-Alt-r'] : [];
      expect(unnamed, platform).toEqual(expected);
      destroy?.();
      destroy = null;
    }
  });

  it('each chord of the macOS column is the Windows chord as the labels spell it', () => {
    for (const row of SHORTCUTS.filter((r) => r.mac === undefined)) {
      expect(chordsOf(macCell(row))).toEqual(chordsOf(row.win).map((c) => chordLabel(c, true)));
    }
  });

  it('the help document is the list, in the form of the platform', () => {
    const windows = shortcutsMarkdown(false);
    const mac = shortcutsMarkdown(true);
    expect(windows.split('\n').slice(0, 4)).toEqual([
      '# Keyboard Shortcuts',
      '',
      '| Keys | Action |',
      '| --- | --- |',
    ]);
    expect(windows).toContain('| `Ctrl+Alt+F` | Insert footnote |');
    expect(windows).toContain('| `Ctrl+Z` / `Ctrl+Y` or `Ctrl+Shift+Z` | Undo / Redo |');
    expect(windows).not.toContain(MAC_NOTE);
    expect(mac).toContain('| `Cmd+Option+R` | Insert footnote |');
    expect(mac).toContain('| `Fn+Shift+F3` | Find previous |');
    expect(mac).toContain('| `Cmd+Enter` in the Replace field | Replace All |');
    expect(mac).toContain(MAC_NOTE);
    expect(windows.split('\n').filter((l) => l.startsWith('| `')).length).toBe(SHORTCUTS.length);
  });
});

/**
 * The chords the guide names that nothing answers: each must be a chord of the
 * list, or a binding of the editor keymap, so the guide cannot name a chord
 * that does nothing (#701, owner decision 4).
 */
function unanswered(text: string): string[] {
  const listed = new Set(SHORTCUTS.flatMap((row) => chordsOf(row.win)).map(normal));
  const keymap = new Set(editorKeymap().map(normal));
  return guideChords(text).filter(
    (chord) => !listed.has(normal(chord)) && !keymap.has(normal(chord)),
  );
}

describe('the chords the User Guide names (#701, owner decision 4)', () => {
  it('names chords, every one of them in bold, where the help finds them', () => {
    expect(guideChords(guide)).toContain('Ctrl+S');
    expect(guideChords(guide)).toContain('Ctrl');
    const outside = guide.replace(/`[^`]*`|\*\*[^*]+\*\*/g, '');
    expect(outside).not.toMatch(/\b(Ctrl|Cmd|Alt|Option)\b|\bShift\+|\bF\d\b/);
  });

  it('every chord it names is a chord of the list or answered by the keymap', () => {
    expect(unanswered(guide)).toEqual([]);
  });

  it('a chord nobody binds, put into the guide, is caught', () => {
    expect(unanswered(`${guide}\nPress **Ctrl+J** to do nothing.\n`)).toEqual(['Ctrl+J']);
  });

  it('opens as written on Windows, and in the macOS form on a Mac', () => {
    expect(guideMarkdown(false)).toBe(guide);
    const mac = guideMarkdown(true);
    for (const chord of [
      '**Cmd+S**',
      '**Cmd+O**',
      '**Cmd+Shift+E**',
      '**Cmd+Option+F**',
      '**Fn+F3**',
      '**Fn+Shift+F3**',
    ]) {
      expect(mac).toContain(chord);
    }
    expect(mac).toContain('hold **Cmd** and click it');
    expect(mac).not.toMatch(/\bCtrl\b/);
    expect(mac.replace(/`[^`]*`|\*\*[^*]+\*\*/g, '')).toBe(
      guide.replace(/`[^`]*`|\*\*[^*]+\*\*/g, ''),
    );
  });

  it('is what Help, User Guide opens, in the form of the platform it runs on', () => {
    expect(helpMarkdown('guide')).toBe(guideMarkdown());
  });
});
