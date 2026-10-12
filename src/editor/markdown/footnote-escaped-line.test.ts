import { beforeEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';
import { markdownToHtml } from './parse';
import { htmlToMarkdown } from './serialize';

/**
 * Issue #418, point d, second half — a line the file escaped is not a
 * definition, and is no longer torn in half.
 *
 * **What it was, measured on `297874c`**: `\[^a\]: the note` under a paragraph
 * came back as three blocks - the paragraph, a paragraph holding a single
 * backslash, and a real definition labelled `a\`. Twenty-three bytes of body
 * in and twenty-six out - twenty-four and twenty-seven as a file, counting the
 * final newline - and a stray line in the document nobody typed. It is the
 * only shape in this family where the *document* changed rather than its
 * spelling, which is what R-C2 asks about since #300.
 *
 * ── Where it came from, and why it is two changes rather than one ──
 *
 * `marked` asks a block extension where the next block could begin, and it
 * asks with the source **one character in**. `start` answered with
 * `/^\[\^/m`, whose `^` matches the start of that slice as readily as the
 * start of a line - so a `[^` one character into a line read as a line start,
 * and the paragraph was cut before it. Requiring a newline in front of the
 * match separates the two: `"ext.\n[^a]: …"` still answers, `"[^a\]: …"` no
 * longer does. Instrumented at the lexer before it was written.
 *
 * That alone stops the tearing but not the change of meaning: the backslashes
 * are gone by then - `marked` consumes every one on the way in - so the line
 * came back `[^a]: the note`, which is a real definition on the next open. So
 * the escape narrowing of #408 steps aside for the one position where an
 * unescaped reference is not a reference: the start of a line, followed by a
 * colon. A definition never reaches that code, being a node of its own, so
 * what is escaped there is only ever text the file escaped.
 *
 * ── What still holds, and is asserted here rather than assumed ──
 *
 * Rows 1 and 3 remain the recorded R-C2 exception: an escaped reference
 * *inside a sentence* still loses its backslashes, because there the two
 * spellings really are one text node. And a definition written on the line
 * directly under a paragraph is still read as a definition - the case dropping
 * `start` would have cost, which the corpus count and `gh api markdown` both
 * weighed.
 */

let host: HTMLElement;
let editor: EditorInstance | null = null;

beforeEach(() => {
  editor?.destroy?.();
  host = document.createElement('div');
  document.body.appendChild(host);
});

/** The parse-serialize pair, with no editor between them. */
function atThePair(markdown: string): string {
  return htmlToMarkdown(markdownToHtml(markdown));
}

/** `createEditor` + `setMarkdown` + `getMarkdown`, as a save assembles it. */
function atTheEditor(markdown: string): string {
  const instance = createEditor(host);
  editor = instance;
  instance.setMarkdown(markdown);
  return instance.getMarkdown().trim();
}

/**
 * Both levels agree, and the bytes are named rather than only compared.
 *
 * The #404 spike found one shape of seventeen that agreed at the pair and was
 * lost at the editor, so a row that passes at one level and not the other is a
 * failure rather than a curiosity.
 */
function bothLevels(source: string, expected: string, bytes: [number, number]): void {
  expect(atThePair(source), 'the parse-serialize pair').toBe(expected);
  expect(atTheEditor(source), 'the editor').toBe(expected);
  expect([source.length, expected.length], 'bytes in, bytes out').toEqual(bytes);
}

describe('the four sources of point d (#418)', () => {
  it('2 — an escaped definition under a paragraph is one paragraph, kept', () => {
    // Before: 'Text.\n\n\\\n\n[^a\\]: the note', 23 bytes of body in and 26 out.
    bothLevels('Text.\n\n\\[^a\\]: the note', 'Text.\n\n\\[^a\\]: the note', [23, 23]);
  });

  it('1 — an escaped reference inside a sentence still loses its backslashes', () => {
    // The recorded R-C2 exception, unchanged by this and asserted so that a
    // later change cannot quietly widen the repair into it.
    bothLevels('Text \\[^a\\] here.', 'Text [^a] here.', [17, 15]);
  });

  it('3 — the same, with only the opening bracket escaped', () => {
    bothLevels('Text \\[^a] here.', 'Text [^a] here.', [16, 15]);
  });

  it('4 — a reference and its definition are untouched', () => {
    bothLevels('Text.[^a]\n\n[^a]: the note', 'Text.[^a]\n\n[^a]: the note', [25, 25]);
  });
});

describe('what the narrowing of start must not cost (#418)', () => {
  it('a definition on the line directly under a paragraph is still a definition', () => {
    // The shape dropping `start` would have turned into prose, measured
    // through `gh api markdown` in gfm mode as a footnote GitHub renders. The
    // blank line it gains is the behaviour of `297874c` and is not moved here.
    const saved = atTheEditor('Text.[^a]\n[^a]: the note');
    expect(saved).toBe('Text.[^a]\n\n[^a]: the note');
    // Still a definition rather than a line of prose: saving the result again
    // moves nothing, which a paragraph holding `[^a]: the note` would not do.
    expect(atTheEditor(saved)).toBe(saved);
  });

  it('a definition at the very start of the document is still read', () => {
    // `start` is never asked about position zero - the tokenizer is called
    // there first - so requiring a newline in front cannot reach this case.
    // Asserted because the reasoning is the kind that is wrong silently.
    expect(atTheEditor('[^a]: the note\n\nText.[^a]')).toBe('[^a]: the note\n\nText.[^a]');
  });

  it('a reference-style link definition is written exactly as it is today', () => {
    // The #408 regression row, re-asserted at this end: the pattern matches
    // only `[^`, and `start` now asks for a newline as well. Since #570 the
    // reference and its definition are kept as the file wrote them.
    expect(atTheEditor('See [docs].\n\n[docs]: https://example.com/d')).toBe(
      'See [docs].\n\n[docs]: https://example.com/d',
    );
    // **And under a paragraph it is not a definition at all**, on `297874c`
    // and here alike - CommonMark does not let one interrupt a paragraph,
    // where GitHub does let a footnote definition interrupt one. So the two
    // constructs differ in this position by intent rather than by accident,
    // and the row is here because the asymmetry is easy to read as a defect.
    // Since #571 the second line stays a line of its own, its brackets
    // escaped as they are anywhere in running text, so it is still no
    // definition when the file is read again.
    expect(atTheEditor('See [docs].\n[docs]: https://example.com/d')).toBe(
      'See \\[docs\\].\n\\[docs\\]: https://example.com/d',
    );
  });
});
