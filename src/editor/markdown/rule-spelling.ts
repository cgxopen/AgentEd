/**
 * A horizontal rule written with the spelling the file gave it (#744, owner
 * decision of 2026-11-17).
 *
 * CommonMark spells a rule with three or more hyphens, asterisks or
 * underscores, spaced or not, indented by up to three spaces, and
 * `serialize.ts` wrote every one `---`: the same rendering, other bytes, the
 * R-C2 exception recorded in #304.
 *
 * ── Read from the token, carried on the node ──
 *
 * `marked` hands each `hr` token its `raw`, the line the file wrote and the
 * line endings after it; the rule node holds nothing, so the line travels as
 * one attribute, the route `heading-spelling.ts` gives the underline of a
 * heading. Nothing is written for `---`, the spelling written unasked.
 *
 * **Only a file.** The attribute is stamped only where the parse keeps raw
 * HTML, which is a file and never a paste, and it is one of the stamped
 * attributes a pasted page cannot supply (#447). A rule the editor makes, by
 * the toolbar, the input rule or a paste, carries none and is written `---`.
 *
 * ── Where the spelling cannot stand ──
 *
 * Two places write a rule otherwise than `---` already, and neither is moved:
 *
 *  - **A rule that opens an item.** The marker and the rule are read as one
 *    rule where they are the same character: `- - - -` and `* ***` are rules,
 *    no list. `rule-in-item.ts` writes `***` in a `-` list for that reason
 *    (#606), and a carried spelling of the marker character gives way to it,
 *    or to `---` in a `*` list. The indentation of a carried spelling is not
 *    written there either, since it would move the content of the item.
 *  - **A document with no metadata block** whose first line would open one is
 *    answered after the whole body is written, by `splitFrontmatter` alone
 *    (`formats/frontmatter.ts`, #304). `---` is never carried, so a carried
 *    spelling cannot make that line; where `---` is written, it still decides.
 *
 * A rule under a block with no blank line between, where the file wrote it
 * so, is read again as a pair by `adjacency-save.ts`, which sees the spelling
 * written, so a run of hyphens that would underline a paragraph after an edit
 * is written a blank line apart, as `---` is.
 */

import { RULE_IN_A_DASH_ITEM } from './rule-in-item';

/** Set on a rule the file spelled otherwise than `---`: the line, encoded. */
export const RULE_SPELLING_ATTRIBUTE = 'data-rule-spelling';

const DEFAULT_RULE = '---';
/** A rule line CommonMark admits: up to three spaces, then three or more of one character. */
const RULE_LINE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/** The spelling an attribute value encodes, or null where it encodes none. */
function spellingOf(value: string | null): string | null {
  if (value === null) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded !== DEFAULT_RULE && RULE_LINE.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** The attribute for the `hr` of an `hr` token, or nothing. */
export function ruleSpellingAttribute(raw: string, fromAFile: boolean): string {
  if (!fromAFile) return '';
  const line = raw.replace(/\n+$/, '');
  // Encoded, since the sanitizer trims an attribute value and the spaces are spelling.
  return spellingOf(encodeURIComponent(line)) === null
    ? ''
    : ` ${RULE_SPELLING_ATTRIBUTE}="${encodeURIComponent(line)}"`;
}

/** The node attribute, read from the element and rendered back onto it. */
export function ruleSpellingNodeAttribute() {
  return {
    spelling: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        spellingOf(element.getAttribute(RULE_SPELLING_ATTRIBUTE)),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.spelling === 'string'
          ? { [RULE_SPELLING_ATTRIBUTE]: encodeURIComponent(attributes.spelling) }
          : {},
    },
  };
}

/**
 * The line to write `rule` with, outside a table cell: the spelling it
 * carries, or the one written unasked. `opened` is the marker of the bullet
 * list whose item the rule opens, or null.
 */
export function ruleLine(rule: Node, unasked: string, opened: string | null): string {
  const fallback = opened === '-' ? RULE_IN_A_DASH_ITEM : unasked;
  const carried = spellingOf((rule as HTMLElement).getAttribute?.(RULE_SPELLING_ATTRIBUTE) ?? null);
  if (carried === null) return fallback;
  if (opened === null) return carried;
  const unindented = carried.replace(/^ +/, '');
  return unindented.startsWith(opened) ? fallback : unindented;
}
