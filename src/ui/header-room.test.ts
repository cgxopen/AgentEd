import { describe, expect, it } from 'vitest';
import { BOTH_SHOWN, countsToHide, type HeaderRoom, HYSTERESIS_PX } from './header-room';

/**
 * Issue #413 — the counts give way to the document name, not to a window width.
 *
 * **Layout is not observable here and that is said first.** happy-dom performs
 * no layout: every width is zero and `offsetParent` is `undefined`. So the
 * decision is split, and this file drives the half that is arithmetic. That the
 * numbers fed to it are the real ones is owed to the manual pass, and the
 * figures below are the ones measured in Chromium on `ee4bb46`:
 *
 * - the 20ch name cap renders at **178.14 px**, a short `a.md` at **35.56 px**
 * - `characters` is **110.38 px** and `words` **80.08 px** at four digits
 * - a digit widens a count by **8.27 px**, and a thousands separator by 12.40
 * - the bar's own gap is **8 px**, `styles.css:278`
 */

const CHARACTERS = 110.38;
const WORDS = 80.08;
const SHORT_NAME = 35.56;
const CAPPED_NAME = 178.14;
/** Three characters of the header's 14 px face, as the probe measures them. */
const RESERVE = 24.81;

/** A bar of `row` px holding `fixed` px of things that never give way. */
function room(over: Partial<HeaderRoom> = {}): HeaderRoom {
  return {
    row: 1000,
    fixed: 600,
    nameWanted: SHORT_NAME,
    reserve: RESERVE,
    charactersCost: CHARACTERS,
    wordsCost: WORDS,
    ...over,
  };
}

describe('the counts give way to the name (#413)', () => {
  it('a short name keeps both counts where the old rule had hidden one', () => {
    // 999 px was below `.indicator-collapse-1000`, so `characters` went -
    // measured with 299.14 px of empty bar still beside it on the Windows
    // frame. The name wants 35.56 and the two counts 190.46 together.
    const at999 = room({ row: 999, fixed: 600, nameWanted: SHORT_NAME });
    expect(countsToHide(at999, BOTH_SHOWN)).toEqual({ characters: false, words: false });
  });

  it('the same width with a name at the 20ch cap loses characters first', () => {
    const at999 = room({ row: 999, fixed: 700, nameWanted: CAPPED_NAME });
    expect(countsToHide(at999, BOTH_SHOWN)).toEqual({ characters: true, words: false });
  });

  it('and narrower still, words goes too', () => {
    const narrow = room({ row: 999, fixed: 800, nameWanted: CAPPED_NAME });
    expect(countsToHide(narrow, BOTH_SHOWN)).toEqual({ characters: true, words: true });
  });

  it('characters never sits in a bar that words has left', () => {
    // The order is owner decision 1: characters first, then words. A bar too
    // narrow for the shorter count cannot be holding the longer one.
    for (let fixed = 600; fixed <= 900; fixed += 7) {
      const answer = countsToHide(room({ fixed }), BOTH_SHOWN);
      if (answer.words) expect(answer.characters, `fixed=${fixed}`).toBe(true);
    }
  });
});

describe('the three characters of free space are in the arithmetic (#413, amendment 1)', () => {
  /** The `fixed` at which `characters` has exactly `slack` px to spare. */
  function fixedLeaving(slack: number): number {
    return 1000 - CAPPED_NAME - RESERVE - WORDS - CHARACTERS - slack;
  }

  it('a name with three characters to spare keeps both counts', () => {
    const r = room({ fixed: fixedLeaving(0), nameWanted: CAPPED_NAME });
    expect(countsToHide(r, BOTH_SHOWN)).toEqual({ characters: false, words: false });
  });

  it('and the same bar without the reserve would have kept them too', () => {
    // The half that gives the row above its meaning: the reserve is what is
    // being tested, so the case has to fail when it is taken away.
    const withoutReserve = room({ fixed: fixedLeaving(0) + RESERVE, nameWanted: CAPPED_NAME });
    expect(countsToHide({ ...withoutReserve, reserve: 0 }, BOTH_SHOWN).characters).toBe(false);
    expect(countsToHide(withoutReserve, BOTH_SHOWN).characters).toBe(true);
  });

  it('a name that fits with two characters of room but not three loses a count', () => {
    const twoNotThree = room({
      fixed: fixedLeaving(0) + RESERVE / 3,
      nameWanted: CAPPED_NAME,
    });
    expect(countsToHide(twoNotThree, BOTH_SHOWN).characters).toBe(true);
  });
});

describe('the expanded name takes its room from the counts (#413, amendment 2)', () => {
  it('a name expanded past its cap hides the counts that no longer fit', () => {
    // The 60ch cap measured 411.33 px; nothing here waits for a transition,
    // because the width wanted comes from the cap rather than from the
    // animation - which is also why this holds for a person who asked the
    // system for less motion, where the transition is taken away entirely.
    const collapsed = room({ row: 999, fixed: 600, nameWanted: CAPPED_NAME });
    const expanded = room({ row: 999, fixed: 600, nameWanted: 411.33 });
    expect(countsToHide(collapsed, BOTH_SHOWN).characters).toBe(false);
    expect(countsToHide(expanded, BOTH_SHOWN).characters).toBe(true);
  });

  it('and gives them back when it is collapsed again, margin or no margin', () => {
    // **The margin is not applied to a collapse**, and this row is why it is
    // not. At this width the collapsed bar clears the need by 5.59 px, less
    // than the 16 px margin, so asking with the margin would hold the counts
    // out after the person had collapsed the name to get them back - which is
    // the margin overruling owner decision 3 rather than stopping flicker.
    const expanded = room({ row: 999, fixed: 600, nameWanted: 411.33 });
    const hidden = countsToHide(expanded, BOTH_SHOWN);
    expect(hidden.characters).toBe(true);
    const collapsed = room({ row: 999, fixed: 600, nameWanted: CAPPED_NAME });
    expect(countsToHide(collapsed, hidden, 0)).toEqual({ characters: false, words: false });
    expect(countsToHide(collapsed, hidden).characters).toBe(true);
  });
});

describe('hysteresis holds a count on the edge still (#413)', () => {
  /**
   * The `fixed` at which `characters` is exactly on the edge, found by search
   * rather than by repeating the arithmetic.
   *
   * **Written this way so that these rows test the margin and nothing else.**
   * A helper that computed the edge from the formula would go red for any
   * change to how the room is worked out - so the reversal that takes the name
   * out of that arithmetic would redden these rows too, and the hysteresis
   * witness would be contained by the witness for the rule. Searching for the
   * edge keeps them independent: whatever the room is derived from, these rows
   * sit on its boundary.
   *
   * Bisection over a bounded range, 40 halvings, which resolves 2000 px to far
   * below a pixel.
   */
  function edge(slack: number): HeaderRoom {
    let tooTight = 2000;
    let roomy = 0;
    for (let step = 0; step < 40; step++) {
      const middle = (tooTight + roomy) / 2;
      if (countsToHide(room({ fixed: middle, nameWanted: CAPPED_NAME }), BOTH_SHOWN).characters) {
        tooTight = middle;
      } else {
        roomy = middle;
      }
    }
    return room({ fixed: roomy - slack, nameWanted: CAPPED_NAME });
  }

  it('the search finds an edge, and it is an edge', () => {
    // The helper is machinery, so it is checked before it is leaned on.
    expect(countsToHide(edge(0), BOTH_SHOWN).characters).toBe(false);
    expect(countsToHide(edge(-1), BOTH_SHOWN).characters).toBe(true);
  });

  it('a count oscillating by one digit around the edge flips once, not every step', () => {
    // **It has to go both ways.** A first version of this row only grew the
    // count, and a number that only grows cannot flicker - it passed with the
    // margin set to zero, which is the one thing it exists to catch. A
    // document edited back and forth across 9 999 words is the real case.
    let state = BOTH_SHOWN;
    const answers: boolean[] = [];
    const at = edge(2);
    for (const extra of [0, 12.4, 0, 12.4, 0, 12.4]) {
      state = countsToHide({ ...at, charactersCost: at.charactersCost + extra }, state);
      answers.push(state.characters);
    }
    const flips = answers.filter((v, i) => i > 0 && v !== answers[i - 1]).length;
    expect(flips, `answers: ${answers.join(',')}`).toBe(1);
    expect(answers.at(-1)).toBe(true);
  });

  it('a count that has left needs the margin, not merely a fit, to come back', () => {
    const hidden = { characters: true, words: false };
    // Five pixels of room is a fit, and it is not enough: the next digit would
    // take it away again. This is the row the margin is for, so it is written
    // at a width where a marginless rule would answer differently.
    expect(countsToHide(edge(5), hidden).characters).toBe(true);
    expect(countsToHide(edge(HYSTERESIS_PX + 1), hidden).characters).toBe(false);
    // And with no memory of having left, the same bar shows it - so the row
    // above is about the margin rather than about the width.
    expect(countsToHide(edge(5), BOTH_SHOWN).characters).toBe(false);
  });

  it('the margin is wider than the widest step a keystroke can make', () => {
    // 12.40 px is a digit plus its thousands separator, measured in Chromium.
    expect(HYSTERESIS_PX).toBeGreaterThan(12.4);
  });
});
