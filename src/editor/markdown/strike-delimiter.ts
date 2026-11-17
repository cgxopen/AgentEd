/**
 * A strikethrough the file wrote with one tilde, written back with one
 * (#744, owner decision of 2026-11-17).
 *
 * GFM spells a strikethrough with one tilde or two, `~gone~` or `~~gone~~`,
 * and `serialize.ts` wrote every one with two: the same rendering, other
 * bytes, the R-C2 exception measured in #85.
 *
 * ── Read from the token, carried on the mark ──
 *
 * The delimiter is lost at serialization, never at parse: `marked` hands each
 * `del` token its `raw`, whose opening run is the delimiter. The strike mark
 * holds no memory of it, so it travels as an attribute, the route #566 gave
 * the delimiter of an emphasis (`emphasis-delimiter.ts`).
 *
 * **Only a file.** The attribute is stamped only where the parse keeps raw
 * HTML, which is a file and never a paste, as `heading-spelling.ts` stamps
 * its own; it is one of the stamped attributes a pasted page cannot supply
 * (#447). So a strike made in the editor, by the toolbar, a shortcut, an input
 * rule or a paste, carries none and is written with two tildes, as before.
 *
 * ── Checked at save ──
 *
 * One tilde closes at the first tilde after it, so it holds less than two do:
 * `~a~b~` is a strike over `a` and then text, where `~~a~b~~` is one strike.
 * An edit can type a tilde into the struck text or against it, or put another
 * strike beside it. So one tilde is written only where the strike reads back
 * as the same strike: no tilde inside, the shape `marked` admits for one, and
 * no tilde, strike or text the HTML does not show on either side. Two are
 * written otherwise, the spelling of before.
 */

/** Set on a strikethrough the file wrote with one tilde. */
export const STRIKE_DELIMITER_ATTRIBUTE = 'data-strike-delimiter';

const ONE_TILDE = '~';
const TWO_TILDES = '~~';

/** The attribute for the tag of a `del` token, or nothing for two tildes. */
export function strikeDelimiterAttribute(raw: string, fromAFile: boolean): string {
  if (!fromAFile || !raw.startsWith(ONE_TILDE) || raw.startsWith(TWO_TILDES)) return '';
  return ` ${STRIKE_DELIMITER_ATTRIBUTE}="${ONE_TILDE}"`;
}

/** The mark attribute, read from the element and rendered back onto it. */
export function strikeDelimiterMarkAttribute() {
  return {
    delimiter: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute(STRIKE_DELIMITER_ATTRIBUTE) === ONE_TILDE ? ONE_TILDE : null,
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.delimiter === ONE_TILDE ? { [STRIKE_DELIMITER_ATTRIBUTE]: ONE_TILDE } : {},
    },
  };
}

const STRIKE = /^(?:S|DEL|STRIKE)$/;
/** The elements whose content is a line of inline text, where the walk below stops. */
const BLOCK = /^(?:P|LI|H[1-6]|TD|TH|BLOCKQUOTE|DIV|UL|OL|TABLE|BODY|PRE)$/;
/** The `del` of `marked` 15 for one tilde, anchored on the whole strike. */
const ONE_TILDE_STRIKE = /^~(?=[^\s~])(?:\\.|[^\\])*?(?:\\.|[^\s~\\])~$/;
/** How deep the walk to the edge of a sibling goes; inline nesting is shallow. */
const MAX_EDGE_DEPTH = 64;

/**
 * Whether what is written at `side` of `node` may begin or end with a tilde:
 * a tilde in the text, a strike, whose delimiter is one, or an element with
 * no text, an image or kept bytes, whose writing the HTML does not show.
 */
function edgeMayBeTilde(node: Node, side: 'before' | 'after'): boolean {
  let current: Node | null = node;
  for (let depth = 0; current !== null && depth < MAX_EDGE_DEPTH; depth++) {
    if (current.nodeType === 3) {
      const text = current.textContent ?? '';
      return side === 'before' ? text.endsWith(ONE_TILDE) : text.startsWith(ONE_TILDE);
    }
    if (STRIKE.test(current.nodeName) || (current.textContent ?? '') === '') return true;
    current = side === 'before' ? current.lastChild : current.firstChild;
  }
  return true;
}

/**
 * Whether a tilde may stand beside `node` on one side in the written
 * markdown: the nearest sibling with something to write, inside the same
 * block, climbing through the marks around it. A line break and the edge of
 * the block answer no.
 *
 * Bounded by the block: the walk climbs no higher than the nearest block and
 * visits each sibling once.
 */
function tildeMayStandBeside(node: Node, side: 'before' | 'after'): boolean {
  let current: Node | null = node;
  while (current !== null && !BLOCK.test(current.nodeName)) {
    let sibling = side === 'before' ? current.previousSibling : current.nextSibling;
    while (sibling !== null) {
      if (sibling.nodeName === 'BR') return false;
      if (sibling.nodeType !== 3 || (sibling.textContent ?? '') !== '') {
        return edgeMayBeTilde(sibling, side === 'before' ? 'before' : 'after');
      }
      sibling = side === 'before' ? sibling.previousSibling : sibling.nextSibling;
    }
    current = current.parentNode;
  }
  return false;
}

/** The delimiter to write `node` with, around `content`, its markdown already written. */
export function strikeDelimiter(node: Node, content: string): string {
  const element = node as HTMLElement;
  if (element.getAttribute?.(STRIKE_DELIMITER_ATTRIBUTE) !== ONE_TILDE) return TWO_TILDES;
  if (content.includes(ONE_TILDE) || !ONE_TILDE_STRIKE.test(`${ONE_TILDE}${content}${ONE_TILDE}`)) {
    return TWO_TILDES;
  }
  const crowded = tildeMayStandBeside(node, 'before') || tildeMayStandBeside(node, 'after');
  return crowded ? TWO_TILDES : ONE_TILDE;
}
