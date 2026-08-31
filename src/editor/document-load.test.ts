/**
 * #206 at the level the defect lives: a document load is not an
 * undoable edit (R-C16).
 *
 * The owner met this by writing in a file, backing out of it with a few
 * undos, and going one past the beginning of his own edits — at which
 * point the whole document went. Redo brought it back, so member 1 is a
 * destroyed screen rather than a destroyed file; member 2, below, is the
 * one that reaches the disk.
 *
 * ── Why the edits are closed by hand ──
 *
 * `prosemirror-history` groups transformations that are both close in
 * time (`newGroupDelay`, 500 ms) and adjacent in position into a single
 * undo event. A test writes faster than a person, so three
 * `insertContentAt` calls in a row become **one** event and the first of
 * them merges into the load transaction itself. Measured on `cd777cd`:
 * three fast adjacent edits gave `undoDepth` 3, not 4, and the third
 * undo emptied the document — *fewer* undos than edits reached the
 * floor.
 *
 * So `edit` closes each history event explicitly, which is what a human
 * pause does, and every count below is the count a person would meet.
 * `groupedEdits` keeps the other half honest: the floor has to hold when
 * the grouping does happen too, and that is the case the issue was
 * written without.
 */

import { closeHistory, redoDepth, undoDepth } from '@tiptap/pm/history';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSearchEngine } from './search-extension';
import { createEditor, type EditorInstance } from './setup';
import { searchAndReplacePluginKey } from './vendor/search-and-replace';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const DOC = '# Title\n\nAlpha paragraph.\n\nBeta paragraph.\n';
const OTHER = '# Other\n\nOther body.\n';

/** Every editor a test opened, torn down afterwards. */
const opened: EditorInstance[] = [];

afterEach(() => {
  while (opened.length > 0) opened.pop()?.destroy();
});

function editorWith(markdown: string): EditorInstance {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const instance = createEditor(element);
  instance.setMarkdown(markdown);
  opened.push(instance);
  return instance;
}

/** One edit in its own undo event, the way a pause between keystrokes makes one. */
function edit(instance: EditorInstance, pos: number, text: string): void {
  instance.editor
    .chain()
    .command(({ tr }) => {
      closeHistory(tr);
      return true;
    })
    .insertContentAt(pos, text)
    .run();
}

/** Edits with no pause between them, so the history groups them as it likes. */
function groupedEdits(instance: EditorInstance, count: number): void {
  for (let n = 0; n < count; n += 1) {
    instance.editor.commands.insertContentAt(3, 'x');
  }
}

/** How many search highlights the editor is currently drawing. */
function decorationCount(instance: EditorInstance): number {
  const decorations = searchAndReplacePluginKey.getState(instance.editor.state);
  return decorations ? decorations.find().length : -1;
}

function undoTimes(instance: EditorInstance, times: number): void {
  for (let n = 0; n < times; n += 1) instance.editor.commands.undo();
}

function redoTimes(instance: EditorInstance, times: number): void {
  for (let n = 0; n < times; n += 1) instance.editor.commands.redo();
}

describe('a document load is not an undoable edit (R-C16)', () => {
  // Criterion 1 — the reported path. Asserted on the markdown the
  // document would be saved as, over three values of N, and with more
  // undos pressed than there are edits to undo.
  for (const n of [1, 3, 6]) {
    it(`bottoms out at the document as loaded after ${n} edits and ${n + 3} undos`, () => {
      const instance = editorWith(DOC);
      const asLoaded = instance.getMarkdown();

      for (let i = 0; i < n; i += 1) edit(instance, 3 + i * 2, 'X');
      expect(instance.getMarkdown()).not.toBe(asLoaded);

      undoTimes(instance, n + 3);
      expect(instance.getMarkdown()).toBe(asLoaded);
    });
  }

  // Criterion 1, the other side of the grouping. The undo count a person
  // needs is not knowable in advance, so this presses far more than
  // enough and asserts the floor rather than a number.
  it('bottoms out when the history groups the edits into fewer events', () => {
    const instance = editorWith(DOC);
    const asLoaded = instance.getMarkdown();

    groupedEdits(instance, 5);
    expect(instance.getMarkdown()).not.toBe(asLoaded);

    undoTimes(instance, 20);
    expect(instance.getMarkdown()).toBe(asLoaded);
    expect(undoDepth(instance.editor.state)).toBe(0);
  });

  // Criterion 2 — the short path: no edit at all.
  it('leaves the document exactly as loaded when undo is pressed with no edit', () => {
    const instance = editorWith(DOC);
    const asLoaded = instance.getMarkdown();

    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(instance.editor.commands.undo()).toBe(false);
    expect(instance.getMarkdown()).toBe(asLoaded);
  });

  // Criterion 3 — THE WIDE HALF. A build with history disabled passes
  // criteria 1 and 2 and fails here.
  it('still undoes the user own edits', () => {
    const instance = editorWith(DOC);
    const asLoaded = instance.getMarkdown();

    edit(instance, 3, 'typed');
    const typed = instance.getMarkdown();
    expect(typed).toContain('typed');

    expect(instance.editor.commands.undo()).toBe(true);
    expect(instance.getMarkdown()).not.toContain('typed');
    expect(instance.getMarkdown()).toBe(asLoaded);
  });

  it('undoes the user own edits one event at a time', () => {
    const instance = editorWith(DOC);

    edit(instance, 3, 'A');
    const afterFirst = instance.getMarkdown();
    edit(instance, 9, 'B');
    const afterSecond = instance.getMarkdown();
    expect(afterSecond).not.toBe(afterFirst);

    expect(undoDepth(instance.editor.state)).toBe(2);
    instance.editor.commands.undo();
    expect(instance.getMarkdown()).toBe(afterFirst);
  });

  // Criterion 4 — REDO STILL WORKS. A repair that gives undo its floor
  // by breaking the stack satisfies every other criterion here.
  it('redoes the edits forward after undo has reached the floor', () => {
    const instance = editorWith(DOC);
    const asLoaded = instance.getMarkdown();

    edit(instance, 3, 'A');
    edit(instance, 9, 'B');
    edit(instance, 15, 'C');
    const afterThird = instance.getMarkdown();

    undoTimes(instance, 4);
    expect(instance.getMarkdown()).toBe(asLoaded);
    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(redoDepth(instance.editor.state)).toBe(3);

    redoTimes(instance, 3);
    expect(instance.getMarkdown()).toBe(afterThird);
  });

  it('leaves redo empty once the edits have been walked forward again', () => {
    const instance = editorWith(DOC);

    edit(instance, 3, 'A');
    const afterEdit = instance.getMarkdown();
    undoTimes(instance, 3);
    redoTimes(instance, 3);

    expect(instance.getMarkdown()).toBe(afterEdit);
    expect(redoDepth(instance.editor.state)).toBe(0);
    expect(instance.editor.commands.redo()).toBe(false);
  });

  // Criterion 5 — member 2, the one that reaches the disk. Measured on
  // `cd777cd` before this repair: one undo after the switch put document
  // A's text on screen while the path pointed at document B.
  it('applies nothing from the previous document to the next one', () => {
    const instance = editorWith(DOC);
    edit(instance, 3, 'EDIT');
    expect(instance.getMarkdown()).toContain('EDIT');

    instance.setMarkdown(OTHER);
    const asLoaded = instance.getMarkdown();

    expect(undoDepth(instance.editor.state)).toBe(0);
    expect(redoDepth(instance.editor.state)).toBe(0);
    expect(instance.editor.commands.undo()).toBe(false);
    expect(instance.getMarkdown()).toBe(asLoaded);
    expect(instance.getMarkdown()).not.toContain('EDIT');
    expect(instance.getMarkdown()).not.toContain('Alpha');
  });

  it('gives the next document a working history of its own', () => {
    const instance = editorWith(DOC);
    edit(instance, 3, 'EDIT');
    instance.setMarkdown(OTHER);
    const asLoaded = instance.getMarkdown();

    edit(instance, 3, 'NEW');
    expect(instance.getMarkdown()).toContain('NEW');
    expect(instance.editor.commands.undo()).toBe(true);
    expect(instance.getMarkdown()).toBe(asLoaded);
    expect(instance.editor.commands.redo()).toBe(true);
    expect(instance.getMarkdown()).toContain('NEW');
  });

  // The empty document is a document like any other: `New` and `Close`
  // reach it through the same primitive, and undo must not bring the
  // closed document back.
  it('does not bring a closed document back through undo', () => {
    const instance = editorWith(DOC);
    edit(instance, 3, 'EDIT');

    instance.setMarkdown('');
    expect(instance.getMarkdown()).toBe('');

    undoTimes(instance, 5);
    expect(instance.getMarkdown()).toBe('');
  });
});

/**
 * The mechanism's blast radius, pinned because it is what chose the
 * mechanism (#206).
 *
 * Resetting the whole `EditorState` would give a fresh history too, and
 * it was the first candidate. It re-initialises **every** plugin's
 * state, and on the one route where a user can plausibly have a search
 * open while the document is replaced under them — a reload after an
 * external change — that showed: the decorations came back empty while
 * `editor.storage.searchAndReplace` still held the previous document's
 * match offsets, so the panel would have counted matches that are not
 * there and Replace would have pointed into a document that is no longer
 * on screen.
 *
 * Dropping and restoring only the history field leaves every other
 * plugin alone, and the content change stays an ordinary transaction, so
 * the decorations recompute against the new document exactly as they did
 * before this repair existed. That is what this asserts.
 */
describe('a document load disturbs nothing but the history', () => {
  it('recomputes the search against the document that is now open', () => {
    const instance = editorWith('# Alpha\n\nneedle here and needle again.\n');
    const engine = createSearchEngine(instance.editor);

    const found = engine.search('needle', {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(found).toEqual({ ok: true, matches: 2, current: 1 });
    expect(decorationCount(instance)).toBe(2);

    instance.setMarkdown('# Beta\n\nNo match in here.\n');

    expect(engine.matchCount()).toBe(0);
    expect(decorationCount(instance)).toBe(0);
  });

  it('finds the matches the new document does have', () => {
    const instance = editorWith('# Alpha\n\nneedle here.\n');
    const engine = createSearchEngine(instance.editor);
    engine.search('needle', { caseSensitive: false, wholeWord: false, regex: false });

    instance.setMarkdown('# Beta\n\nneedle, needle and needle.\n');
    // The query survives the load, as it always has; the count is the
    // new document's.
    engine.search('needle', { caseSensitive: false, wholeWord: false, regex: false });

    expect(engine.matchCount()).toBe(3);
    expect(decorationCount(instance)).toBe(3);
  });
});
