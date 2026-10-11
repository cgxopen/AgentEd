import type TurndownService from 'turndown';

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
 * Shift+Enter or a file that spelled them, a backslash as two spaces as its
 * own exception records, and `<br>` in a table cell by #300.
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

/** The spelling a raw inline HTML token holds, or `null` where it is not one plain `br`. */
export function brSpelling(raw: string): string | null {
  const match = /^<([^<>]*)>$/.exec(raw.trim());
  const inner = match?.[1] ?? '';
  return PLAIN_BR.test(inner) ? inner : null;
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
        return PLAIN_BR.test(value) ? value : null;
      },
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.spelling === 'string' && PLAIN_BR.test(attributes.spelling)
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
      return PLAIN_BR.test((node as HTMLElement).getAttribute(BR_SPELLING_ATTRIBUTE) ?? '');
    },
    replacement: (_content, node) =>
      `<${(node as HTMLElement).getAttribute(BR_SPELLING_ATTRIBUTE)}>`,
  });
}
