import type TurndownService from 'turndown';
import { softBreakElement } from './soft-break';

/**
 * A line break the file wrote as a `br` tag, written back as that tag (#577,
 * owner decision of 2026-10-11: before 1.0.0).
 *
 * A `<br>` in a line became a hard break the editor holds, and the serializer
 * wrote every hard break as two trailing spaces: the same rendering, other
 * bytes, and a break that many editors and linters strip as trailing
 * whitespace. Measured by the step zero of #563: `br` in 373 of 8706 files of
 * this machine, respelled in 257.
 *
 * ── Read from the token, carried on the node ──
 *
 * `marked` hands each `br` in a line to the `html` renderer as a token of its
 * own, its bytes in `raw`. Measured on the 8706 files, the 802 such tokens hold
 * four spellings and no attribute: `<br>` 493, `<br />` 276, `<br/>` 29 and
 * `<Br>` 4. The hard break holds no spelling, so the tag travels as an
 * attribute, the route #566 gave the delimiter of an emphasis and #431 the
 * marker of a list. The value is the tag without its angle brackets, `br`,
 * `br/` or `br /` in the case the file wrote, since DOMPurify trims a value
 * and a bracket has no place in one.
 *
 * **A hard break with no attribute is written as before**: two spaces from
 * Shift+Enter, a paste or a file that spelled them, and `<br>` in a table cell
 * by #300. Since #584 a trailing backslash carries the same attribute, and a
 * block of `br` tags alone is read as the paragraph of hard breaks it is drawn
 * as; both are below.
 *
 * ── The newline after it ──
 *
 * A `br` followed by a newline is a hard break and then a soft break, and #571
 * leaves a soft break beside a hard break unwritten, since the two spaces end
 * the line already. A kept tag does not end the line, so the soft break beside
 * it is written: `soft-break.ts` drops only one beside a plain `<br>`, and the
 * element this module renders carries its attribute.
 */

/** Set on a hard break the file wrote as a tag, holding the tag without its brackets. */
export const BR_SPELLING_ATTRIBUTE = 'data-br-spelling';

/** The tags carried: `br` in any case, an optional slash, no attribute. */
const PLAIN_BR = /^br ?\/?$/i;

/**
 * A hard break the file wrote as a trailing backslash (#584, owner decision on
 * #584): the same attribute, holding the backslash itself. Measured on #583:
 * 311 in 62 files of the corpus, written as two spaces until #584.
 */
const BACKSLASH = '\\';

/** Whether an attribute value is one this module wrote. */
function isSpelling(value: string): boolean {
  return value === BACKSLASH || PLAIN_BR.test(value);
}

/** The spelling a raw inline HTML token holds, or `null` where it is not one plain `br`. */
export function brSpelling(raw: string): string | null {
  const match = /^<([^<>]*)>$/.exec(raw.trim());
  const inner = match?.[1] ?? '';
  return PLAIN_BR.test(inner) ? inner : null;
}

/** The element for a `br` token of `marked`, a backslash before a newline kept as such. */
export function hardBreakElement(raw: string): string {
  return raw.startsWith(BACKSLASH) ? brElement(BACKSLASH) : '<br>';
}

/**
 * A block of `br` tags alone, a line of its own between blank lines, as the
 * paragraph of hard breaks the editor already drew it as (#584, route b of
 * the step zero, owner decision on #584), each keeping its tag and each line
 * after the first its newline and indentation. `null` for any other block.
 *
 * It used to be drawn so and written as a line of two spaces, which is a blank
 * line, so the next open dropped it: 566 tags in 93 files of the corpus. The
 * one thing not kept is the indentation of the first line, which a paragraph
 * cannot carry: 12 blocks in 12 files, recorded under R-C2.
 */
export function brBlockParagraph(raw: string): string | null {
  const body = raw.replace(/\s+$/, '');
  const lines = body.split('\n');
  if (!lines.every((line) => /^[ \t]*(?:<br ?\/?>)+$/i.test(line))) return null;
  const inner = lines
    .map((line, i) => {
      const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
      const tags = Array.from(line.matchAll(/<(br ?\/?)>/gi), (m) => brElement(m[1] ?? 'br'));
      return (i === 0 ? '' : softBreakElement('', indent)) + tags.join('');
    })
    .join('');
  return `<p>${inner}</p>\n`;
}

/** The element for a plain `br` token, carrying its spelling. */
export function brElement(spelling: string): string {
  return `<br ${BR_SPELLING_ATTRIBUTE}="${spelling}">`;
}

/** The node attribute, read from the element and rendered back onto it. */
export function brSpellingNodeAttribute() {
  return {
    spelling: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute(BR_SPELLING_ATTRIBUTE) ?? '';
        return isSpelling(value) ? value : null;
      },
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.spelling === 'string' && isSpelling(attributes.spelling)
          ? { [BR_SPELLING_ATTRIBUTE]: attributes.spelling }
          : {},
    },
  };
}

/**
 * Registered by `serialize.ts`, which is over the module size guideline, after
 * its cell rule: turndown consults the rule added last first, and this one
 * leaves a cell to that rule. `inCell` answers whether a cell is being
 * written, since a cell is written from its inner HTML alone.
 */
export function addBrSpellingRules(turndown: TurndownService, inCell: () => boolean): void {
  turndown.addRule('brSpelling', {
    filter: (node) => {
      if (node.nodeName !== 'BR' || inCell()) return false;
      return isSpelling((node as HTMLElement).getAttribute(BR_SPELLING_ATTRIBUTE) ?? '');
    },
    replacement: (_content, node) => {
      const spelling = (node as HTMLElement).getAttribute(BR_SPELLING_ATTRIBUTE);
      // A backslash ends its line itself, as two spaces do; a tag does not.
      return spelling === BACKSLASH ? `${BACKSLASH}\n` : `<${spelling}>`;
    },
  });
}
