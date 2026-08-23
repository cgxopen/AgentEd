/**
 * Narrowing turndown's text escaping to what CommonMark actually needs (#90).
 *
 * Turndown escapes every `_` in a text node unconditionally, because from one
 * text node it cannot know whether the character was markdown syntax.
 * CommonMark is narrower than that, and the gap was pure noise in the user's
 * file: `cl100k_base` was written back as `cl100k\_base` on every save of
 * every document naming an identifier — same rendering, different bytes, in
 * every diff (R-C2).
 *
 * **One case is narrowed, and only one: an underscore that cannot be a
 * delimiter.** CommonMark forbids intraword emphasis with `_`, so a run with
 * word characters on both sides can neither open nor close it, and
 * `foo_bar_baz` is literal text.
 *
 * `*` is **not** the same case and is deliberately left alone: intraword
 * emphasis *is* allowed with it, so `foo*bar*baz` is `foo<em>bar</em>baz` and
 * its escape is load-bearing. Relaxing the two symmetrically would turn a
 * bytes-only difference into a visible one.
 *
 * **The vantage point is one text node**, which is where turndown calls this,
 * and the narrowing is confined to what that vantage point can actually
 * decide. Intraword-ness is *local*: it is settled by the two characters
 * beside the run, and a text-node boundary simply makes the run
 * non-intraword — the safe answer. So a `_` at the edge of a node escapes,
 * and `foo_bar <strong>x</strong> baz_qux` survives a round trip.
 *
 * **Backtick runs are not narrowed, and cannot be from here.** Whether a run
 * opens a code span depends on another run of the same length existing
 * somewhere in the same *block*, which is a property this vantage point
 * structurally cannot see: a partner one text node away looks like no partner
 * at all, and withholding both would let the re-read pair them and swallow the
 * link or the `<strong>` standing between them — measured on #96, and a
 * visible loss where `main` was correct. Recorded in R-C2 as a known
 * exception; if it is ever revisited, the thing to change is the vantage
 * point, not this rule.
 *
 * Everything else in turndown's escape table — `*`, `` ` ``, `[`, `]`, `#`,
 * `>`, `-`, and the rest — is left exactly as it was, by delegating to the
 * original method rather than restating the table. Only the one narrowed case
 * is withheld from it.
 */

/**
 * Stand-in for the underscores withheld from turndown's table, chosen from the
 * Private Use Area so nothing in that table matches it. One sentinel per
 * character keeps the string's length and every offset intact, which matters:
 * several of turndown's rules are anchored to the start of the string.
 */
const KEPT_UNDERSCORE = '\uE000';

/**
 * A character CommonMark's flanking rules count as neither whitespace nor
 * punctuation. Letters and numbers are a deliberate under-approximation of
 * that set: anything else falls through to being escaped, which is the safe
 * direction.
 */
function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

/**
 * Withhold every `_` run that has word characters on both sides. A run at
 * either end of the text node has an `undefined` neighbour, which is not a
 * word character, so it escapes — the uncertain case costs bytes rather than
 * meaning.
 */
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
 * Wrap turndown's own `escape` so the narrowed case passes through it
 * untouched. `escapeAll` is the original method: it stays the authority on
 * every other character, so a future turndown release that adds an escape
 * keeps working here without this file knowing about it.
 */
export function createNarrowedEscape(
  escapeAll: (text: string) => string,
): (text: string) => string {
  return (text: string): string => {
    // A document that already contains the sentinel would have it silently
    // rewritten on the way back. Vanishingly unlikely — it is a Private Use
    // Area code point — but the failure would be a corrupted character in the
    // user's file, so the whole narrowing steps aside instead: the text is
    // escaped exactly as it was before #90.
    if (text.includes(KEPT_UNDERSCORE)) {
      return escapeAll(text);
    }

    return escapeAll(keepIntrawordUnderscores(text)).replaceAll(KEPT_UNDERSCORE, '_');
  };
}
