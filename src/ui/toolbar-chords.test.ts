import { type Editor, getExtensionField } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupKeyboard } from '../app/keyboard';
import { createEditor } from '../editor/setup';
import { listedActions, SHORTCUTS } from '../help/shortcuts';
import { chordLabel } from './chord-label';
import { closeHeadingLevels, HEADING_CHOICES, openHeadingLevels } from './heading-levels';
import { isActionEntry, shippedButtons, type ToolbarHandlers } from './toolbar';

vi.mock('./toast', () => ({ showToast: vi.fn() }));

/**
 * The toolbar names the chord of every control that has one, and only chords
 * of the list of #701 (#702). Nothing here writes a chord: the titles are read
 * off what ships, the chords off the list, and which control a chord belongs
 * to is found by running both on the same document and comparing.
 */

/** A control as a person meets it: its tooltip, and what pressing it does. */
interface Control {
  readonly title: string;
  readonly run?: (editor: Editor) => void;
}

const handlers: ToolbarHandlers = { onLink: vi.fn(), onImageDescription: vi.fn() };

/** The rows of the heading list as it renders, each tooltip read off the DOM. */
function headingRows(): string[] {
  const anchor = document.createElement('button');
  const toolbar = document.createElement('div');
  document.body.append(toolbar, anchor);
  const list = openHeadingLevels({ anchor, toolbar, current: null, onChoose: () => {} });
  const titles = Array.from(list.element.querySelectorAll('button'), (row) => row.title);
  closeHeadingLevels();
  anchor.remove();
  toolbar.remove();
  return titles;
}

/** Every control the toolbar ships, the rows of its heading list among them. */
function shippedControls(): Control[] {
  const rows = headingRows();
  return shippedButtons.flatMap((entry): Control[] => {
    if (isActionEntry(entry))
      return [{ title: entry.title, run: (e) => entry.action(e, handlers) }];
    return [
      { title: entry.title },
      ...entry.choices.map((choice, i) => ({
        title: rows[HEADING_CHOICES.indexOf(choice)] ?? `missing row ${i}`,
        run: (e: Editor) => entry.choose(e, choice),
      })),
    ];
  });
}

/** The chords a tooltip names: what its closing brackets hold, a run by its two ends. */
function namedChords(title: string): string[] {
  const inner = /\(([^()]+)\)$/.exec(title)?.[1];
  return inner === undefined ? [] : inner.split(' … ');
}

/** Every chord the list names, each digit of a run included. */
function listedChords(): Set<string> {
  return new Set(
    SHORTCUTS.flatMap((row) => [
      ...[...row.win.matchAll(/`([^`]+)`/g)].map((m) => m[1]),
      ...listedActions(row).map((listed) => listed.chord),
    ]),
  );
}

/** A chord as a set of keys, so `Ctrl+Alt+1` and `Mod-Alt-1` compare equal. */
function normal(chord: string): string {
  const parts = chord.split(/[+-](?=.)/);
  const key = parts.pop() ?? '';
  const mods = parts.map((p) => (p === 'Ctrl' ? 'Mod' : p)).sort();
  return [...mods, key.length === 1 ? key.toLowerCase() : key].join('+');
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fresh editor, its keymap by the keys each binding holds, and its teardown. */
interface Trial {
  readonly editor: Editor;
  readonly keymap: Map<string, () => boolean>;
  readonly destroy: () => void;
}

/** A fresh editor, so no history or state carries from one trial to the next. */
function trial(): Trial {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const instance = createEditor(element);
  const keymap = new Map<string, () => boolean>();
  for (const ext of instance.editor.extensionManager.extensions) {
    const context = {
      name: ext.name,
      options: ext.options,
      storage: ext.storage,
      editor: instance.editor,
      type: null,
    };
    const shortcuts = getExtensionField(ext, 'addKeyboardShortcuts', context) as
      | (() => Record<string, () => boolean>)
      | undefined;
    if (!shortcuts) continue;
    for (const [key, run] of Object.entries(shortcuts()))
      if (!keymap.has(normal(key))) keymap.set(normal(key), run);
  }
  return {
    editor: instance.editor,
    keymap,
    destroy: () => {
      instance.destroy();
      element.remove();
    },
  };
}

/**
 * The documents a control or a chord is tried on, `beta` selected in each.
 * Two heading levels, so a chord that toggles one level is not taken for the
 * row that goes back to body text from it.
 */
const STARTS = ['<p>alpha beta</p>', '<h2>alpha beta</h2>', '<h3>alpha beta</h3>'];

/** What `act` leaves of each start, each on a fresh editor, or `null` where it changed nothing. */
function outcomes(act: (t: Trial) => void): Array<string | null> {
  return STARTS.map((html) => {
    const t = trial();
    try {
      t.editor.commands.setContent(html);
      t.editor.commands.setTextSelection({ from: 7, to: 11 });
      const before = JSON.stringify(t.editor.getJSON());
      act(t);
      const after = JSON.stringify(t.editor.getJSON());
      return after === before ? null : after;
    } finally {
      t.destroy();
    }
  });
}

/**
 * Whether a chord does what a control does: the control changes something on
 * some start, and on every start where it does, the chord leaves the same.
 * A chord that toggles may undo a start the control leaves alone; that is
 * the difference the tooltip does not name.
 */
function sameEffect(control: Array<string | null>, chord: Array<string | null>): boolean {
  const acted = control.flatMap((outcome, i) => (outcome === null ? [] : [i]));
  return acted.length > 0 && acted.every((i) => chord[i] === control[i]);
}

/** The chords tooltips name that the list does not: `title: chord`. */
function unlisted(controls: Control[]): string[] {
  const listed = listedChords();
  return controls.flatMap(({ title }) =>
    namedChords(title)
      .filter((chord) => !listed.has(chord))
      .map((chord) => `${title}: ${chord}`),
  );
}

/**
 * Each control and listed chord the keymap answers that do the same to the
 * same document, with whether the tooltip names that chord. A chord a tooltip
 * names that the keymap answers and that does something else is reported too.
 */
function disagreements(controls: Control[]): { unnamed: string[]; misnamed: string[] } {
  const probe = trial();
  const chords = [...listedChords()].filter((chord) => probe.keymap.has(normal(chord)));
  probe.destroy();
  const byChord = new Map(
    chords.map((chord) => [chord, outcomes((t) => t.keymap.get(normal(chord))?.())]),
  );
  const unnamed: string[] = [];
  const misnamed: string[] = [];
  for (const control of controls) {
    if (!control.run) continue;
    const run = control.run;
    const mine = outcomes((t) => run(t.editor));
    const named = namedChords(control.title);
    for (const chord of chords) {
      const same = sameEffect(mine, byChord.get(chord) ?? []);
      if (same && !named.includes(chord)) unnamed.push(`${control.title}: ${chord}`);
      if (!same && named.includes(chord)) misnamed.push(`${control.title}: ${chord}`);
    }
  }
  return { unnamed, misnamed };
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

/** Whether the document listener of `app/keyboard.ts` answers `chord`. */
function answeredByListener(chord: string): boolean {
  let calls = 0;
  const count = () => {
    calls++;
  };
  const controller = new AbortController();
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) =>
    add(type, listener, {
      ...(typeof options === 'object' ? options : {}),
      signal: controller.signal,
    }),
  );
  setupKeyboard({
    onSave: count,
    onOpen: count,
    onLink: count,
    onCodeBlock: count,
    onToggleSidebar: count,
  });
  vi.mocked(document.addEventListener).mockRestore();
  document.dispatchEvent(keydown(chord));
  controller.abort();
  return calls > 0;
}

/** The chords tooltips name that neither the keymap nor our listener answers. */
function unanswered(controls: Control[]): string[] {
  const probe = trial();
  const keymap = new Set(probe.keymap.keys());
  probe.destroy();
  return controls.flatMap(({ title }) =>
    namedChords(title)
      .filter((chord) => !keymap.has(normal(chord)) && !answeredByListener(chord))
      .map((chord) => `${title}: ${chord}`),
  );
}

describe('the toolbar names the chords of the list (#702)', () => {
  it('reads a tooltip for every control and every row of the heading list', () => {
    const titles = shippedControls().map((c) => c.title);
    expect(titles).toHaveLength(shippedButtons.length + HEADING_CHOICES.length);
    expect(titles.filter((t) => namedChords(t).length > 0).length).toBeGreaterThan(12);
  });

  it('every chord a tooltip names is a chord of the list', () => {
    expect(unlisted(shippedControls())).toEqual([]);
  });

  it('every chord a tooltip names is answered, by the keymap or our listener', () => {
    expect(unanswered(shippedControls())).toEqual([]);
    expect(unanswered([{ title: 'Strikethrough (Ctrl+J)' }])).toEqual([
      'Strikethrough (Ctrl+J): Ctrl+J',
    ]);
  });

  it('a chord the list does not hold, named by a tooltip, is caught', () => {
    const controls = [...shippedControls(), { title: 'Strikethrough (Ctrl+J)' }];
    expect(unlisted(controls)).toEqual(['Strikethrough (Ctrl+J): Ctrl+J']);
  });

  it('a control that does what a chord of the list does names that chord, and only such a chord', () => {
    expect(disagreements(shippedControls())).toEqual({ unnamed: [], misnamed: [] });
  });

  it('a control whose tooltip drops its chord is caught', () => {
    const controls = shippedControls().map((c) =>
      c.title.startsWith('Strikethrough') ? { ...c, title: 'Strikethrough' } : c,
    );
    expect(disagreements(controls).unnamed).toEqual(['Strikethrough: Ctrl+Shift+S']);
  });

  it('on a Mac, every tooltip names its chord as the labels spell it there', async () => {
    const windows = shippedControls().map((c) => c.title);
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    vi.resetModules();
    const toolbar = await import('./toolbar');
    const levels = await import('./heading-levels');
    const mac = [
      ...toolbar.shippedButtons.flatMap((entry) =>
        isActionEntry(entry)
          ? [entry.title]
          : [entry.title, ...levels.HEADING_CHOICES.map(levels.choiceTitle)],
      ),
    ];
    expect(mac).toEqual(windows.map((title) => chordLabel(title, true)));
    expect(mac.filter((title, i) => title !== windows[i]).length).toBeGreaterThan(12);
  });
});
