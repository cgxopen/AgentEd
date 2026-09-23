import { FOOTNOTE_REFERENCE } from './footnote';

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

/** The two halves of a footnote reference, held out of turndown's escape (#408). */
const KEPT_BRACKET_OPEN = '\uE010';
const KEPT_BRACKET_CLOSE = '\uE011';

/**
 * A reference that starts its **text node** and is followed by a colon (#409).
 *
 * It is a question rather than an answer: whether it starts its *line* is
 * decided in `resolveDefinitionPositions`, which sees the assembled markdown.
 * The mark never reaches a file - every one of them is consumed or dropped
 * there, on the way out of `htmlToMarkdown`.
 */
export const DEFINITION_POSITION = '\uE012';

/**
 * Whether the document being written already carries a mark of its own (#425).
 *
 * **The sentinel idiom in this file has a document half and a node half, and
 * only the node half existed.** For the three older sentinels a text node
 * holding one gives up the narrowing for that node, which is enough for them:
 * nothing downstream of the escape looks for them again. The mark is
 * different - `resolveDefinitionPositions` sweeps the **assembled markdown**
 * for it, so a U+E012 the file itself carries was deleted on save even where
 * the escape never ran: measured at `42457a3`, a fenced block went from 31
 * bytes to 28 and a code span from 16 to 13, three bytes each, which is the
 * character in UTF-8.
 *
 * So the question is asked once per document, in `htmlToMarkdown`, and
 * answered here: a document carrying the character is written with **no mark
 * made and the reference narrowing given up entirely**, which is the node
 * rule at document scope. The underscore narrowing is untouched - the mark
 * has nothing to do with it.
 *
 * **What that costs, and it was the owner decision of 2026-09-23 taken on the
 * figures**: in such a document every footnote reference is written escaped,
 * so GitHub draws it as literal text rather than as a footnote. The
 * alternative measured beside it kept the references unescaped, and on the
 * shape that tells the two apart - the character in a fenced block and, in
 * another block, a line the file escaped as text - it dropped the backslashes
 * and the line reopened as a real definition: 57 bytes in, 55 out, the
 * document changing shape. This way that row is 57 in and 57 out.
 *
 * A module-level flag rather than a parameter, because the escape is built
 * once at load and turndown calls it with one string; `serialize.ts` sets it
 * around the call it owns, the shape `writingKeptTables` already has there.
 */
let documentCarriesTheMark = false;

export function setDocumentCarriesTheMark(value: boolean): void {
  documentCarriesTheMark = value;
}

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
 * Whether this reference, written unescaped, **might** be read back as a
 * footnote definition rather than as the text it is (#418, narrowed by #409).
 *
 * `[^a]: the note` at the start of a line is a definition, and a definition is
 * never a text node - it is a node of its own with its own rule. So a
 * reference that reaches this function in that position is text the file
 * escaped, and writing it unescaped would turn a sentence into a definition on
 * the next open.
 *
 * **This answers about the text node, which is less than the question.**
 * Offset 0 of a text node is the start of a line only when nothing stands in
 * front of the node on that line, and the escape cannot see whether anything
 * does: `**Note**[^1]: see below` and `[^1]: see below` hand this function the
 * identical string `[^1]: see below` at offset 0 - measured at `37d4c07`, the
 * two documents produce the same text node. So what this decides is a
 * **candidate**, marked with a sentinel and settled in
 * `resolveDefinitionPositions` below, where the assembled line is readable.
 */
function mayOpenADefinition(text: string, offset: number, length: number): boolean {
  const atNodeLineStart = offset === 0 || text[offset - 1] === '\n';
  return atNodeLineStart && text[offset + length] === ':';
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

    // A footnote reference passes through unescaped (#408). Turndown escapes
    // `[` and `]` in every text node, so `[^a]` came back as `\[^a\]` - and
    // once the definition beside it is understood, the two spell different
    // documents rather than the same one. The same sentinel shape as the
    // underscore above, and the same step aside if a document already holds a
    // sentinel: the whole narrowing is given up rather than risk rewriting a
    // character the user typed.
    if (
      text.includes(KEPT_BRACKET_OPEN) ||
      text.includes(KEPT_BRACKET_CLOSE) ||
      text.includes(DEFINITION_POSITION)
    ) {
      return escapeAll(text);
    }
    const held = text.replace(
      FOOTNOTE_REFERENCE,
      (whole: string, label: string, offset: number) => {
        // In a document carrying the mark, the reference is handed back
        // untouched and turndown escapes it as it did before #408 (#425). No
        // mark is made anywhere in such a document, so the sweep that would
        // have deleted the person's character never runs.
        if (documentCarriesTheMark) return whole;
        const reference = `${KEPT_BRACKET_OPEN}${label}${KEPT_BRACKET_CLOSE}`;
        // Held unescaped either way; a candidate carries the mark that asks the
        // serializer to look at the line it landed on (#409).
        return mayOpenADefinition(text, offset, whole.length)
          ? `${DEFINITION_POSITION}${reference}`
          : reference;
      },
    );
    return escapeAll(keepIntrawordUnderscores(held))
      .replaceAll(KEPT_UNDERSCORE, '_')
      .replaceAll(KEPT_BRACKET_OPEN, '[^')
      .replaceAll(KEPT_BRACKET_CLOSE, ']');
  };
}

/**
 * A reference standing where a definition could begin, escaped; every other
 * mark dropped (#409).
 *
 * ── Why this is here and not in the escape above ──
 *
 * The escape sees one text node, and whether a reference begins a **line** is
 * not a property of the node: after `**Note**` the text node still begins at
 * offset 0. #418 read offset 0 as a line start, so a reference to a defined
 * footnote written right after bold, italic, a code span or a link came back
 * `\[^1\]` - and that is the construct losing its meaning rather than its
 * bytes. Measured through `gh api markdown` at `37d4c07`: the unescaped form
 * renders as a footnote reference with the footnote section under it, the
 * escaped form as literal text with **no section at all**, the definition
 * being referred to by nothing.
 *
 * Here the whole markdown is assembled, so the line is readable — and the
 * question is answered exactly rather than approximated: a definition is read
 * back only where the line begins with one, allowing the prefixes a container
 * writes in front of its content.
 *
 * ── What counts as a position a definition can open in ──
 *
 * Measured at `37d4c07`, driving each shape through the editor:
 *
 *  - `[^a]: note` alone in a paragraph **is** read back as a definition.
 *  - `- [^a]: note` and `> [^a]: note` are too, inside the item and the quote.
 *  - `# [^a]: note` and a table cell holding the same are **not** - they come
 *    back as the heading and the cell they were. Both of those are escaped at
 *    `37d4c07` and are bytes this change gives back.
 *
 * So the prefix admitted here is the blockquote marker, the list marker, and
 * the indentation either may carry — each with an explicit bound, since this
 * reads user text.
 */
const DEFINITION_PREFIX = /^[ \t]{0,16}(?:>[ \t]{0,1}){0,8}(?:(?:[-*+]|\d{1,9}[.)])[ \t]{1,4})?$/;

/** The reference the mark stands in front of, read at the mark. */
const REFERENCE_AT_MARK = /^\[\^([^\]\n]+)\]/;

/**
 * The most marks one document is examined for. A document past it keeps the
 * bytes the escape wrote, which is the unescaped spelling, and the marks are
 * stripped by the sweep below rather than left in the file.
 */
const MARK_LIMIT = 100000;

export function resolveDefinitionPositions(markdown: string): string {
  if (!markdown.includes(DEFINITION_POSITION)) return markdown;
  const pieces: string[] = [];
  let cursor = 0;
  for (let guard = 0; guard < MARK_LIMIT; guard += 1) {
    const at = markdown.indexOf(DEFINITION_POSITION, cursor);
    if (at === -1) break;
    pieces.push(markdown.slice(cursor, at));
    cursor = at + DEFINITION_POSITION.length;
    const lineStart = markdown.lastIndexOf('\n', at - 1) + 1;
    const inFront = markdown.slice(lineStart, at);
    const reference = REFERENCE_AT_MARK.exec(markdown.slice(cursor));
    if (reference === null || !DEFINITION_PREFIX.test(inFront)) continue;
    // The spelling turndown itself writes for these two characters, which is
    // what the file held before #408 and what #418 gave back to this case.
    pieces.push(`\\[^${reference[1]}\\]`);
    cursor += reference[0].length;
  }
  pieces.push(markdown.slice(cursor));
  // Whatever the loop did not reach cannot travel: a mark is this module's
  // own character and no document may carry one out.
  return pieces.join('').replaceAll(DEFINITION_POSITION, '');
}
