import { type MarkedExtension, Tokenizer } from 'marked';

/**
 * A list item ends at a line that opens an HTML block with an end tag (#604,
 * K1b of the step zero, owner decision 1 of 2026-10-17).
 *
 * ── What was lost ──
 *
 * `marked` ends a list item at a line that opens an HTML block only when a
 * letter or `!--` follows the angle bracket: its rule is `<(?:[a-z].*>|!--)`.
 * An end tag opens with `</`, so `</details>` directly under the last line of
 * a list was read as a lazy line of that item. CommonMark reads it otherwise:
 * an end tag of one of the block elements of its HTML block type 6 opens an
 * HTML block, which ends the list. With the end tag inside the item, the
 * `details` route of #563 found no end tag alone after the list and did not
 * join the region, so an unedited save dropped the `details` and `summary`
 * tags and wrote the end tag into the last item: measured on the step zero
 * (comment 6236166181), 17 files (14 distinct) of the corpus snapshot.
 *
 * ── The route ──
 *
 * The list tokenizer of `marked` is called as it is, with its rule widened
 * for the length of the call to the end tags CommonMark names. The rule is a
 * function `marked` builds per item indentation, so the widened one keeps that
 * indentation and the rest of the rule, and the tokenizer is not restated. A
 * nested list is tokenized inside the call and sees the same rule. The rule is
 * put back when the call returns, whatever it returns.
 *
 * Only an end tag at the start of a line, indented less than the content of
 * the item, ends it: an end tag indented into the item is part of it, as
 * before. Measured on the step zero, every corpus file and every CommonMark
 * example is saved to the same bytes with the whole list as with `</details>`
 * alone, which is why the rule is the CommonMark one rather than one name.
 */

/** The element names of the CommonMark HTML block type 6, whose tags open an HTML block. */
const BLOCK_ELEMENTS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

/** What the list tokenizer reads its rules from: the shared `other` rules of `marked`. */
interface ListTokenizer {
  readonly rules: { readonly other: { htmlBeginRegex: (indent: number) => RegExp } };
}

/** The rule of `marked`, `<(?:[a-z].*>|!--)` at up to three spaces, and the end tags beside it. */
function withEndTags(indent: number): RegExp {
  const end = `<\\/(?:${BLOCK_ELEMENTS})(?:\\s|\\/?>|$)`;
  return new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:<(?:[a-z].*>|!--)|${end})`, 'i');
}

/** The extension `parse.ts` registers: the list tokenizer of `marked`, with end tags ending an item. */
export const listItemEndExtension: MarkedExtension = {
  tokenizer: {
    list(src) {
      const other = (this as unknown as ListTokenizer).rules.other;
      const own = other.htmlBeginRegex;
      other.htmlBeginRegex = withEndTags;
      try {
        return Tokenizer.prototype.list.call(this, src);
      } finally {
        other.htmlBeginRegex = own;
      }
    },
  },
};
