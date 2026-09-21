/**
 * Whether the header still has room for the word and character counts (#413).
 *
 * Until this, the two counts left the bar at fixed window widths - 1000 px for
 * characters, 800 px for words - whatever the document was called. Measured on
 * `ee4bb46` at 999 px, a document named `a.md` had **550 px of empty bar** on
 * the plain shape and had just lost its character count. The width was standing
 * in for the question *does the name have room*, and answering that question
 * directly is what this module is for.
 *
 * **It is arithmetic, not layout.** Everything here takes numbers and returns
 * two booleans, because layout is the one thing the test harness cannot see:
 * happy-dom performs no layout, so every width is zero and `offsetParent` is
 * `undefined`. `watchHeaderRoom` below does the measuring and is verified by
 * the manual pass; `countsToHide` is driven whole by the suite.
 */

/** The widths the decision is made from. All in CSS pixels. */
export interface HeaderRoom {
  /** The menubar's content width, inside its own padding. */
  readonly row: number;
  /**
   * Everything in the row that never gives way: the hamburger, the brand and
   * caption buttons where the build draws its own frame, the token readout,
   * the search button, the badges, the kebab, and the gaps between them.
   *
   * The caller derives it by conservation rather than by adding the items up,
   * so an item added to the header later is counted without touching this.
   */
  readonly fixed: number;
  /**
   * What the name **wants**, not what it currently gets: `min(scrollWidth,
   * cap)`, where the cap is 20ch collapsed and 60ch expanded.
   *
   * **This is what stops the rule chasing itself.** A name is a flex item and
   * shrinks below its own cap when the bar runs out - measured at 801 px on the
   * Windows frame, where the capped name was 128.70 px rather than 178.14. Read
   * the width it is *shown* at and the loop closes: hide a count, the bar gains
   * room, the name grows, and the count now fits again. The desired width does
   * not move when a count is hidden, so the answer is stable.
   */
  readonly nameWanted: number;
  /**
   * Three characters of free space beside the name, in the name's own font
   * (owner decision 2 on #413, made a term of its own by amendment 1). It is
   * reserved here rather than left to the bar's 8 px gap or to the hysteresis
   * margin, both of which are there for other reasons.
   */
  readonly reserve: number;
  /** What `characters` costs the row: its own width plus the gap before it. */
  readonly charactersCost: number;
  /** The same for `words`. */
  readonly wordsCost: number;
}

/** Which of the two counts is out of the bar. */
export interface Hidden {
  readonly characters: boolean;
  readonly words: boolean;
}

export const BOTH_SHOWN: Hidden = { characters: false, words: false };

/**
 * The margin a count must clear to come **back** into the bar (#413).
 *
 * Measured on `ee4bb46`: one digit widens a count by 8.27 px, and a digit that
 * opens a new thousands group widens it by 12.40 px, the digit plus its
 * separator. 12.40 is therefore the widest step a single keystroke can produce,
 * and a margin at or below it would let a count on the edge appear and vanish
 * as the document grows by one character. 16 px is that worst step plus about
 * 29 per cent, and still less than two digits of the name it is protecting.
 */
export const HYSTERESIS_PX = 16;

/**
 * Whether something of width `need` fits in `available`.
 *
 * Asymmetric on purpose, and that asymmetry is the hysteresis: a count already
 * in the bar keeps its place while it merely fits, and one that has left has to
 * clear `margin` as well before it comes back.
 */
function fits(need: number, available: number, wasHidden: boolean, margin: number): boolean {
  return wasHidden ? need + margin <= available : need <= available;
}

/**
 * Which counts have to leave the bar, given the room and the previous answer.
 *
 * **Characters goes first, then words**, which is the order the fixed
 * breakpoints had and which owner decision 1 keeps. So `characters` is asked
 * for the room *both* counts take: it can only be in the bar when `words` is,
 * and a bar too narrow for `words` is too narrow for either.
 *
 * `previous` is what makes the margin mean anything - with no memory of the
 * last answer there is no edge to hold.
 */
export function countsToHide(room: HeaderRoom, previous: Hidden, margin = HYSTERESIS_PX): Hidden {
  const available = room.row - room.fixed - room.nameWanted - room.reserve;
  const wordsIn = fits(room.wordsCost, available, previous.words, margin);
  const charactersIn =
    wordsIn && fits(room.wordsCost + room.charactersCost, available, previous.characters, margin);
  return { characters: !charactersIn, words: !wordsIn };
}

/** The class that takes a count out of the bar. */
export const NO_ROOM_CLASS = 'indicator-no-room';

/**
 * A span outside the flow, used to ask what a piece of text **would** measure.
 *
 * Needed because a count that has left the bar carries `display: none`, whose
 * width is zero, while its text keeps updating behind it - so the width that
 * decides whether it can come back cannot be read from the element itself. The
 * span is absolutely positioned and hidden, so it is in the layout tree and
 * measurable while taking no room in the bar.
 */
function makeProbe(parent: HTMLElement, className: string): HTMLElement {
  const probe = document.createElement('span');
  probe.className = className;
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden;pointer-events:none';
  parent.appendChild(probe);
  return probe;
}

function widthOf(probe: HTMLElement, text: string): number {
  probe.textContent = text;
  return probe.getBoundingClientRect().width;
}

function pixels(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Measure the header and put the two counts in or out of the bar (#413).
 *
 * **`fixed` is derived by conservation rather than by adding the items up.**
 * The row is the name, the free space between the two groups, the counts that
 * are in it, and everything else; so everything else is the row less the other
 * three. An item added to the header later is then counted with nothing here
 * changed, where a hand-written sum would silently omit it.
 *
 * Returns the measure function, so a caller that has just changed the name can
 * ask for a fresh answer without waiting for an event.
 */
export function watchHeaderRoom(): () => void {
  const bar = document.getElementById('menubar');
  const left = bar?.querySelector<HTMLElement>('.header-left') ?? null;
  const indicators = document.getElementById('header-indicators');
  const readout = document.getElementById('count-readout');
  const filename = document.getElementById('filename');
  const words = document.getElementById('word-count');
  const characters = document.getElementById('char-count');
  if (!bar || !left || !indicators || !readout || !filename || !words || !characters) {
    // The header is asserted by `header-markup.test.ts`; a build that reaches
    // here without it has a broken page, and a silent no-op is the wrong answer
    // only if it hides something - the counts simply keep the bar.
    throw new Error('the header is missing an element the room rule measures');
  }

  const countProbe = makeProbe(readout, 'indicator indicator-secondary');
  const nameProbe = makeProbe(left, '');
  // The name probe takes its metrics from `#filename` itself rather than from a
  // rule repeating them, so the reserve cannot drift away from the name it is
  // reserved beside when the header's type changes.
  function matchNameFont(): void {
    const from = getComputedStyle(filename as HTMLElement);
    for (const property of ['fontSize', 'fontWeight', 'fontFamily', 'letterSpacing'] as const) {
      nameProbe.style[property] = from[property];
    }
  }
  matchNameFont();
  let previous: Hidden = BOTH_SHOWN;

  /**
   * `margin` is the hysteresis, and it is **not** applied to every trigger.
   *
   * The margin is there so a count on the edge does not flicker as its own
   * number gains a digit, and so a slow drag across the edge flips once. A
   * click that collapses the name is neither: it is an act, and owner decision
   * 3 says the counts come back on collapse. Measured at 999 px, a collapsed
   * bar clears the need by 5.59 px - less than the 16 px margin - so asking
   * with the margin would hold the counts out after the person collapsed the
   * name to get them back. A name change therefore asks with no margin.
   */
  function measure(margin = HYSTERESIS_PX): void {
    const barStyle = getComputedStyle(bar as HTMLElement);
    const readoutStyle = getComputedStyle(readout as HTMLElement);
    const row =
      (bar as HTMLElement).clientWidth -
      pixels(barStyle.paddingLeft) -
      pixels(barStyle.paddingRight);
    const columnGap = pixels(readoutStyle.columnGap);

    const nameNow = (filename as HTMLElement).getBoundingClientRect().width;
    // What the name wants: its text, or its cap, whichever is smaller. The cap
    // is whichever `max-width` is in force, which is the expanded one while the
    // name is expanded - so a click is read from the class rather than from the
    // animated width, and needs no `transitionend` (amendment 2 on #413). That
    // also keeps the rule working for a person who asked the system for less
    // motion, where `styles.css` takes the transition away and the event would
    // never arrive.
    const cap = pixels(getComputedStyle(filename as HTMLElement).maxWidth);
    const wanted = (filename as HTMLElement).scrollWidth;
    const nameWanted = cap > 0 ? Math.min(wanted, cap) : wanted;

    const wordsCost = widthOf(countProbe, words?.textContent ?? '') + columnGap;
    const charactersCost = widthOf(countProbe, characters?.textContent ?? '') + columnGap;
    const shown = (previous.words ? 0 : wordsCost) + (previous.characters ? 0 : charactersCost);

    const gap =
      (indicators as HTMLElement).getBoundingClientRect().left -
      (left as HTMLElement).getBoundingClientRect().right -
      pixels(barStyle.columnGap);
    const fixed = row - nameNow - gap - shown;

    // Three characters of the name's own font, reserved beside it.
    const reserve = widthOf(nameProbe, '000');

    const next = countsToHide(
      { row, fixed, nameWanted, reserve, charactersCost, wordsCost },
      previous,
      margin,
    );
    characters?.classList.toggle(NO_ROOM_CLASS, next.characters);
    words?.classList.toggle(NO_ROOM_CLASS, next.words);
    previous = next;
  }

  window.addEventListener('resize', () => measure());
  // The name is read from its class, so the click is the whole of the trigger:
  // no wait for `transitionend`, which would never arrive for a person who
  // asked the system for less motion. No margin either - see `measure`.
  filename.addEventListener('click', () => queueMicrotask(() => measure(0)));
  document.addEventListener('click', () => queueMicrotask(() => measure(0)));
  // **Only when a count changes its width** (amendment 3 on #413). The text
  // changes on every keystroke; its width moves only when it gains or loses a
  // character, so the length is compared first and the layout is read second.
  let lengths = `${words.textContent?.length}:${characters.textContent?.length}`;
  new MutationObserver(() => {
    const now = `${words.textContent?.length}:${characters.textContent?.length}`;
    if (now === lengths) return;
    lengths = now;
    measure();
  }).observe(readout, { subtree: true, childList: true, characterData: true });
  // The widths above are font metrics, so the first answer is provisional until
  // the face the header asks for has arrived.
  document.fonts?.ready
    .then(() => {
      matchNameFont();
      measure(0);
    })
    .catch(() => {});

  measure(0);
  // The caller re-measures after a change it made itself - the window frame
  // drawn on Windows, a new document name - and those are acts too.
  return () => measure(0);
}
