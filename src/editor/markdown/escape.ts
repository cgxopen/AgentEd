/**
 * Narrowing turndown's text escaping to what CommonMark actually needs (#90).
 *
 * Turndown escapes every `_` and every `` ` `` in a text node unconditionally,
 * because from one text node it cannot know whether the character was markdown
 * syntax. CommonMark is narrower than that, and the gap is pure noise in the
 * user's file: `cl100k_base` was written back as `cl100k\_base` on every save
 * of every document naming an identifier — same rendering, different bytes, in
 * every diff (R-C2).
 *
 * Two cases are narrowed, and only two:
 *
 *   - **An underscore that cannot be a delimiter.** CommonMark forbids
 *     intraword emphasis with `_`, so a run with word characters on both sides
 *     can neither open nor close it. `foo_bar_baz` is literal text.
 *     **`*` is not the same case and is deliberately left alone**: intraword
 *     emphasis *is* allowed with it, so `foo*bar*baz` is `foo<em>bar</em>baz`
 *     and its escape is load-bearing. Relaxing the two symmetrically would
 *     turn a bytes-only difference into a visible one.
 *   - **A backtick run with no partner.** A run only opens a code span when a
 *     run of the *same length* closes it, so a lone `` ` `` — or a bare
 *     ` ``` ` quoted in running text — is literal.
 *
 * **The vantage point is one text node**, which is where turndown calls this.
 * A partner living across an element boundary is invisible from here, so the
 * uncertain case escapes: that costs bytes, and the other direction would cost
 * meaning.
 *
 * Everything else in turndown's escape table — `*`, `[`, `]`, `#`, `>`, `-`,
 * and the rest — is left exactly as it was, by delegating to the original
 * method rather than restating the table. Only the two narrowed cases are
 * withheld from it.
 */

/**
 * Stand-ins for the characters withheld from turndown's table, chosen from the
 * Private Use Area so nothing in that table matches them. One sentinel per
 * character keeps the string's length and every offset intact, which matters:
 * several of turndown's rules are anchored to the start of the string.
 */
const KEPT_UNDERSCORE = '\uE000';
const KEPT_BACKTICK = '\uE001';

/**
 * A character CommonMark's flanking rules count as neither whitespace nor
 * punctuation. Letters and numbers are a deliberate under-approximation of
 * that set: anything else falls through to being escaped, which is the safe
 * direction.
 */
function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

/** Withhold every `_` run that has word characters on both sides. */
function keepIntrawordUnderscores(text: string): string {
  return text.replace(/_+/g, (run, offset: number) => {
    const before = text[offset - 1];
    const after = text[offset + run.length];
    return isWordCharacter(before) && isWordCharacter(after)
      ? KEPT_UNDERSCORE.repeat(run.length)
      : run;
  });
}

/**
 * Withhold every backtick run that no run of equal length could pair with.
 * Runs are compared within this text node alone — see the vantage-point note
 * above.
 *
 * A length is judged, not a position: if two runs of the same length are
 * present, **both** are escaped, rather than only the one that could open a
 * span. Escaping just the opener would also round-trip — the survivor is then
 * a lone run and therefore literal — but it makes the second run's safety
 * depend on the first run's backslash, which is a property no future edit to
 * this file would know it had to preserve.
 */
function keepUnpairedBacktickRuns(text: string): string {
  const runs = [...text.matchAll(/`+/g)];
  const countByLength = new Map<number, number>();
  for (const run of runs) {
    countByLength.set(run[0].length, (countByLength.get(run[0].length) ?? 0) + 1);
  }
  const closable = new Set<number>();
  runs.forEach((run, index) => {
    if ((countByLength.get(run[0].length) ?? 0) > 1) closable.add(index);
  });

  let result = '';
  let cursor = 0;
  runs.forEach((run, index) => {
    const start = run.index;
    result += text.slice(cursor, start);
    result += closable.has(index) ? run[0] : KEPT_BACKTICK.repeat(run[0].length);
    cursor = start + run[0].length;
  });
  return result + text.slice(cursor);
}

/**
 * Wrap turndown's own `escape` so the two narrowed cases pass through it
 * untouched. `escapeAll` is the original method: it stays the authority on
 * every other character, so a future turndown release that adds an escape
 * keeps working here without this file knowing about it.
 */
export function createNarrowedEscape(
  escapeAll: (text: string) => string,
): (text: string) => string {
  return (text: string): string => {
    // A document that already contains a sentinel would have it silently
    // rewritten on the way back. Vanishingly unlikely — these are Private Use
    // Area code points — but the failure would be a corrupted character in the
    // user's file, so the whole narrowing steps aside instead: the text is
    // escaped exactly as it was before #90.
    if (text.includes(KEPT_UNDERSCORE) || text.includes(KEPT_BACKTICK)) {
      return escapeAll(text);
    }

    const withheld = keepUnpairedBacktickRuns(keepIntrawordUnderscores(text));
    return escapeAll(withheld).replaceAll(KEPT_UNDERSCORE, '_').replaceAll(KEPT_BACKTICK, '`');
  };
}
