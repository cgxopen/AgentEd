import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from './state';

describe('AppState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with no document loaded', () => {
    const state = new AppState();
    expect(state.filePath).toBeNull();
    expect(state.frontmatter).toBeNull();
    expect(state.modified).toBe(false);
    // The other half of #51: the agreement is per folder and per
    // *window*, and this default is the whole of what makes it end
    // with the window — R-C8 gives each window its own AppState, so a
    // fresh one having agreed to nothing is the promise. It lives here
    // because it is a default, and defaults live in this test.
    expect(state.assetsDirConfirmedFor).toBeNull();
  });

  it('setModified notifies listeners with the new value', () => {
    const state = new AppState();
    const received: boolean[] = [];
    state.onModifiedChange((v) => received.push(v));

    state.setModified(true);
    state.setModified(false);
    expect(received).toEqual([true, false]);
  });

  it('resetDocument clears the per-document fields', () => {
    const state = new AppState();
    state.filePath = '/tmp/x.md';
    state.frontmatter = 'title: x';
    state.isFirstSave = false;
    state.destinationCueShown = true;

    state.resetDocument();
    expect(state.filePath).toBeNull();
    expect(state.frontmatter).toBeNull();
    expect(state.isFirstSave).toBe(true);
    // The next document has its own silence to explain (#48).
    expect(state.destinationCueShown).toBe(false);
  });

  /**
   * The counterpart of the test above, and the reason it is a separate
   * one: `resetDocument` is where the per-document fields go, and the
   * assets/ agreement deliberately is not among them (#51, R-C5). Left
   * as an omission inside the test above it would read as something
   * nobody had got round to asserting.
   */
  it("resetDocument keeps the assets/ agreement — it is the folder's, not the document's (#51)", () => {
    const state = new AppState();
    state.assetsDirConfirmedFor = '/tmp/assets';

    state.resetDocument();

    expect(state.assetsDirConfirmedFor).toBe('/tmp/assets');
  });

  it('starts with spellcheckEnabled=false', () => {
    expect(new AppState().spellcheckEnabled).toBe(false);
  });

  it('setSpellcheck notifies listeners only on value change', () => {
    const state = new AppState();
    const received: boolean[] = [];
    state.onSpellcheckChange((v) => received.push(v));

    state.setSpellcheck(true);
    state.setSpellcheck(true); // no-op
    state.setSpellcheck(false);
    expect(received).toEqual([true, false]);
  });
});
