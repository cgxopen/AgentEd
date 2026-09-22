import { describe, expect, it } from 'vitest';
import raw from './header-room.ts?raw';

/** The source with its line breaks flattened, so a row asserts the code and
 * not the width biome happened to wrap it to. */
const roomSource = raw.replace(/\s+/g, ' ');

/**
 * Issue #418, points a and b — what asks the header to measure again.
 *
 * **Said first, and it is why these rows read source.** Both repairs are about
 * *when* a measurement happens, and a measurement is layout: happy-dom performs
 * none, so every width is zero, every answer is the same answer, and a row that
 * drove the observer would watch nothing change. Building each repair backwards
 * and running the suite confirms it - the name watcher removed leaves 4006
 * passing, as removing the toolbar floor did on #416.
 *
 * So these rows hold the mechanism at the one address that has it, the shape
 * `toolbar-floor.test.ts` uses for the same reason. **What they cannot hold is
 * that the measurement is right**, and the manual pass on the header at 1000,
 * 800 and 600 px is where that is seen.
 */

describe('a new document name asks again (#418, point a)', () => {
  it('the name is watched, not left to whoever sets it', () => {
    // Measured on `7fd1550` in the built web app at 650, 600, 560 and 520 px: a
    // short name kept `characters` and a long one kept it too, until a resize.
    // `setFilename` writes the text and imports nothing from the header, so the
    // watch has to be here.
    expect(roomSource).toContain('new MutationObserver(() => measure(0)).observe(nameElement');
  });

  it('and it asks with no margin, because a document arriving is an act', () => {
    // No margin: the hysteresis is there for drift, and a document arriving
    // is not drift. `measure` says so at its own head.
    expect(roomSource).toContain('MutationObserver(() => measure(0)).observe(nameElement');
    expect(roomSource).not.toContain('MutationObserver(() => measure()).observe(nameElement');
  });

  it('the comment no longer tells a caller to do what nothing did', () => {
    // The defect was a comment naming a new document name among the things a
    // caller re-measures after, with nothing wired. It says the window frame
    // now, which is the whole of that list.
    expect(roomSource).not.toMatch(/drawn on Windows, a new document name/);
  });
});

describe('a click asks again only when it moved the name (#418, point b)', () => {
  it('the click handlers go through the comparison rather than straight to a measure', () => {
    // Measured on `7fd1550`: at 800, 700 and 620 px there is exactly one count
    // width at each where a click on the body brought back a count the 16 px
    // margin was holding out.
    expect(roomSource).toContain(
      "filename.addEventListener('click', () => queueMicrotask(measureIfTheNameMoved))",
    );
    expect(roomSource).toContain(
      "document.addEventListener('click', () => queueMicrotask(measureIfTheNameMoved))",
    );
    // The shape that was there before, and which the reversal puts back.
    expect(roomSource).not.toContain(
      "addEventListener('click', () => queueMicrotask(() => measure(0)))",
    );
  });

  it('and the comparison is on the expanded state, which is the only thing a click moves', () => {
    const fn = roomSource.match(/function measureIfTheNameMoved\(\): void \{(.*?)\}/);
    expect(fn, 'the comparison is no longer a function of its own').toBeDefined();
    expect(fn?.[1]).toContain("classList.contains('expanded')");
    expect(fn?.[1]).toContain('if (now === wasExpanded) return;');
    expect(fn?.[1]).toContain('measure(0)');
  });
});

describe('the fonts promise reports rather than swallows (#418, point c)', () => {
  it('the catch logs', () => {
    // `FontFaceSet.ready` does not reject - measured, Chromium resolves it with
    // a `FontFaceSet` and happy-dom has no `document.fonts` at all - so what an
    // empty handler hid was an error thrown by the two calls inside the `then`,
    // which are ours.
    expect(roomSource).not.toContain('.catch(() => {})');
    expect(roomSource).toContain('.catch((e: unknown) => console.error(');
  });
});
