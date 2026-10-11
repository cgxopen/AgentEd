import type TurndownService from 'turndown';

/**
 * Which delimiter an emphasis or a strong emphasis was written with (#566,
 * owner decision of 2026-10-09: repaired before 1.0.0).
 *
 * `serialize.ts` writes every emphasis with `*` and every strong one with
 * `**`, from two turndown options, so `_word_` came back `*word*` and
 * `__word__` came back `**word**`: the same rendering, other bytes, in 416 of
 * 1985 public files measured by AMP on #566, and 20 examples of the
 * CommonMark suite.
 *
 * ── Read from the token, carried on the mark ──
 *
 * The delimiter is lost at serialization, never at parse: `marked` hands each
 * `em` and `strong` token its `raw`, whose first character is the delimiter,
 * in every shape measured on this issue - nested, adjacent, three in a row,
 * inside a link text or a heading, across a soft break. The marks hold no
 * memory of it, so it travels as an attribute, the route #431 gave the
 * marker of a list (`list-marker.ts`).
 *
 * **Nothing is written for `*`**, the delimiter the serializer writes unasked,
 * so an emphasis made in the editor, by Ctrl+I, Ctrl+B or the toolbar, has no
 * attribute and is written with asterisks, as before.
 *
 * ── Where an underscore cannot stand ──
 *
 * CommonMark lets an underscore open or close emphasis only at a word edge:
 * `foo_bar_baz` is no emphasis at all, where `foo*bar*baz` is. An emphasis
 * the file spelled with underscores can come to sit inside a word by an edit,
 * a letter typed against it, and an underscore written there would leave
 * literal underscores in the file. So where the character before the opening
 * delimiter, or after the closing one, is a letter or a digit, the asterisk is
 * written instead. That is the one fallback, recorded under R-C2.
 */

/** Set on an `em` or a `strong` the file wrote with underscores. */
export const EMPHASIS_DELIMITER_ATTRIBUTE = 'data-emphasis-delimiter';

const UNDERSCORE = '_';

/** The attribute for the tag of an `em` or `strong` token, or nothing for `*`. */
export function emphasisDelimiterAttribute(raw: string): string {
  return raw.startsWith(UNDERSCORE) ? ` ${EMPHASIS_DELIMITER_ATTRIBUTE}="${UNDERSCORE}"` : '';
}

/** The mark attribute, read from the element and rendered back onto it. */
export function emphasisDelimiterMarkAttribute() {
  return {
    delimiter: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute(EMPHASIS_DELIMITER_ATTRIBUTE) === UNDERSCORE ? UNDERSCORE : null,
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.delimiter === UNDERSCORE ? { [EMPHASIS_DELIMITER_ATTRIBUTE]: UNDERSCORE } : {},
    },
  };
}

/** The elements whose content is a line of inline text, where the walk below stops. */
const BLOCK = /^(?:P|LI|H[1-6]|TD|TH|BLOCKQUOTE|DIV|UL|OL|TABLE|BODY|PRE)$/;

/**
 * The character the written markdown has beside `node`, on one side, as far as
 * the editor HTML tells it: the nearest text at that side inside the same
 * block, a line break as a newline, and nothing at the edge of the block.
 * An element with no text, an image or kept bytes, is passed over, so the
 * answer can only be more cautious than the file: a letter found past an
 * image makes the asterisk be written where an underscore would have held.
 *
 * Bounded by the block: the walk climbs no higher than the nearest block and
 * visits each sibling once.
 */
function charBeside(node: Node, side: 'before' | 'after'): string {
  let current: Node | null = node;
  while (current !== null && !BLOCK.test(current.nodeName)) {
    let sibling = side === 'before' ? current.previousSibling : current.nextSibling;
    while (sibling !== null) {
      if (sibling.nodeName === 'BR') return '\n';
      const text = sibling.textContent ?? '';
      if (text !== '') return side === 'before' ? text.charAt(text.length - 1) : text.charAt(0);
      sibling = side === 'before' ? sibling.previousSibling : sibling.nextSibling;
    }
    current = current.parentNode;
  }
  return '';
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Whether an underscore can open and close around `node`. turndown writes the
 * whitespace at either end of the content outside the delimiters, so that
 * whitespace is what stands beside them then.
 */
function underscoreHolds(node: Node): boolean {
  const text = node.textContent ?? '';
  const before = /^\s/.test(text) ? ' ' : charBeside(node, 'before');
  const after = /\s$/.test(text) ? ' ' : charBeside(node, 'after');
  return !WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after);
}

function spelledWithUnderscores(node: Node, names: readonly string[]): boolean {
  return (
    names.includes(node.nodeName) &&
    (node as HTMLElement).getAttribute(EMPHASIS_DELIMITER_ATTRIBUTE) === UNDERSCORE &&
    underscoreHolds(node)
  );
}

/** Registered by `serialize.ts`, which is over the module size guideline. */
export function addEmphasisDelimiterRules(turndown: TurndownService): void {
  turndown.addRule('underscoreEmphasis', {
    filter: (node) => spelledWithUnderscores(node, ['EM', 'I']),
    replacement: (content) => (content.trim() === '' ? '' : `_${content}_`),
  });
  turndown.addRule('underscoreStrong', {
    filter: (node) => spelledWithUnderscores(node, ['STRONG', 'B']),
    replacement: (content) => (content.trim() === '' ? '' : `__${content}__`),
  });
}
