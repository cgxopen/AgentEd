import type TurndownService from 'turndown';
import { FOOTNOTE_DEFINITION_ATTRIBUTE } from './footnote';

/**
 * A line break inside a paragraph, the wrap of a hard-wrapped file, carried
 * from the file to the file (#571, owner decision on #571, comment 6108819945).
 *
 * It used to be lost twice, measured on the step zero (comment 6108769223):
 * ProseMirror's parser collapses every whitespace run outside `pre` into one
 * space, and turndown collapses it again on the way out, so `one two`, a
 * newline, `three four` was saved as one line. On 8706 files of this machine
 * 4905 rewrote a wrap on an unedited save, 1142 for no other cause.
 *
 * **The route, route A of that report:** `marked` keeps the newline in the
 * text token, so the text renderer of `parse.ts` writes each one as the element
 * below; the editor holds it as an inline atom drawn as a space
 * (`soft-break-node.ts`); and the serializer writes it as the newline again,
 * after which turndown's container rules prefix the next line as they prefix
 * every other one.
 *
 * **The whitespace around the newline travels on the element.** `marked`
 * keeps a space before the newline and the indentation after it in the text
 * token, the indentation measured from the container, so both are written back
 * as the file had them. What it does not keep cannot come back: a lazy line,
 * one with no container marker, is written with the marker; and a code span
 * across a wrap is joined by the `marked` lexer before any code of ours runs.
 * Both are recorded under R-C2.
 */

/** Present on the element standing for a soft break. */
export const SOFT_BREAK_ATTRIBUTE = 'data-soft-break';

/** The spaces or tabs before the newline. Absent when there were none. */
export const SOFT_BREAK_SPACE_ATTRIBUTE = 'data-soft-break-space';

/** The spaces or tabs after the newline, past the container. Absent when there were none. */
export const SOFT_BREAK_INDENT_ATTRIBUTE = 'data-soft-break-indent';

/** A newline with the spaces and tabs on both sides of it. */
const NEWLINE_IN_TEXT = /([ \t]*)\n([ \t]*)/g;

/**
 * Whitespace as an attribute value can hold it: DOMPurify trims every value it
 * keeps, so a value of spaces alone arrives empty. Each space is written `s`
 * and each tab `t`; nothing else is ever encoded.
 */
export function encodeWhitespace(whitespace: string): string {
  return whitespace.replace(/ /g, 's').replace(/\t/g, 't');
}

/** The whitespace an attribute value stands for; any other character stands for none. */
export function decodeWhitespace(value: string | null): string {
  return (value ?? '').replace(/[^st]/g, '').replace(/s/g, ' ').replace(/t/g, '\t');
}

/** The element a soft break is rendered as, from the whitespace the file wrote around it. */
export function softBreakElement(space: string, indent: string): string {
  const spaced = space === '' ? '' : ` ${SOFT_BREAK_SPACE_ATTRIBUTE}="${encodeWhitespace(space)}"`;
  const indented =
    indent === '' ? '' : ` ${SOFT_BREAK_INDENT_ATTRIBUTE}="${encodeWhitespace(indent)}"`;
  return `<span ${SOFT_BREAK_ATTRIBUTE}=""${spaced}${indented}> </span>`;
}

/**
 * Escaped HTML of a text token, with every newline the file wrote in it as a
 * soft break. Only a token the inline lexer read from the file is passed here:
 * a token `marked` builds itself carries `escaped`, and `parse.ts` leaves its
 * newlines alone, so a newline `marked` joins two tokens with never becomes a
 * break (item 2 of the decision).
 */
export function withSoftBreaks(html: string): string {
  return html.replace(NEWLINE_IN_TEXT, (_m, space: string, indent: string) =>
    softBreakElement(space, indent),
  );
}

/** A soft break element as `softBreakElement` writes it, at the start or the end of a string. */
const EDGE_BREAKS =
  /^(?:<span data-soft-break=""[^>]*> <\/span>)+|(?:<span data-soft-break=""[^>]*> <\/span>)+$/g;

/**
 * The inline HTML of a paragraph with no soft break at either end. CommonMark
 * strips the whitespace that ends a paragraph, and `marked` can leave a
 * newline there, measured on example 241 of the spec, a quote whose last line
 * holds a space: a break with no line after it is not a wrap.
 */
export function withoutEdgeBreaks(inline: string): string {
  return inline.replace(EDGE_BREAKS, '');
}

/** A soft break as `softBreaksAsVoid` writes it. */
const VOID_BREAK = '<br data-soft-break=""[^>]*>';

/** The elements of the marks, as the editor renders them, with no attribute. */
const MARK_TAG = '(?:em|strong|s|u|code|sup|sub|kbd)';

/**
 * The editor HTML with each soft break as a void element, placed where the
 * serializer can write it.
 *
 * The element the editor renders holds a single space, and turndown treats an
 * element holding only whitespace as blank: it hands it to the blank rule
 * before any rule of ours, and writes its space beside whatever that returns.
 * A `br` is void, so it is never blank, and its rule below is consulted. The
 * attributes go with it unchanged.
 *
 * Two placements are made here, each measured on the corpus of the step zero
 * as a file that moved again on the second save:
 * - **a break at the edge of a mark goes outside it.** Emphasis that ends on
 *   the break was written `*use`, newline, `*`, and a delimiter at the start of
 *   a line closes nothing, so the second save escaped both. Outside, it is
 *   written `*use*`, newline, as the space at the edge of a mark always was;
 * - **a break beside a hard break is not written.** `text`, a newline, `<br>`,
 *   a newline, `text` held a break on either side of the hard break, and the
 *   hard break written as two spaces then stood alone on a line, which is a
 *   blank line, so the paragraph split in two. The hard break ends the line
 *   already.
 */
export function softBreaksAsVoid(html: string): string {
  if (!html.includes(SOFT_BREAK_ATTRIBUTE)) return html;
  return html
    .replace(/<span (data-soft-break=""[^>]*)> <\/span>/g, '<br $1>')
    .replace(new RegExp(`(${VOID_BREAK})((?:</${MARK_TAG}>)+)`, 'g'), '$2$1')
    .replace(new RegExp(`((?:<${MARK_TAG}>)+)(${VOID_BREAK})`, 'g'), '$2$1')
    .replace(new RegExp(`${VOID_BREAK}(?=<br>)|(?<=<br>)${VOID_BREAK}`, 'g'), '');
}

/**
 * Inside a heading or a table cell the content is one line, and a footnote
 * definition writes its own lines (#408): a soft break there is a space, as it
 * was before #571 (item 1 of the decision).
 */
const ONE_LINE = `h1, h2, h3, h4, h5, h6, td, th, [${FOOTNOTE_DEFINITION_ATTRIBUTE}]`;

/**
 * Four spaces `marked` takes from a continuation line of a list item, measured
 * on `marked` 15.0.12: past the item's own indentation, a line indented by four
 * or more is reported with four fewer, once, where a top-level paragraph or a
 * quote reports every space. So an indentation of four or more read inside an
 * item had four more in the file, and is written with them, or each save
 * would take four again; one of zero to three may have had four more or none,
 * and is written as read, which holds still.
 */
const ITEM_INDENT_TAKEN = '    ';

function indentToWrite(node: HTMLElement, indent: string): string {
  const inItem = node.closest('li, blockquote')?.nodeName === 'LI';
  return inItem && indent.length >= ITEM_INDENT_TAKEN.length ? ITEM_INDENT_TAKEN + indent : indent;
}

function softBreakReplacement(node: HTMLElement, inCell: boolean): string {
  if (inCell || node.closest(ONE_LINE) !== null) return ' ';
  const space = decodeWhitespace(node.getAttribute(SOFT_BREAK_SPACE_ATTRIBUTE));
  const indent = decodeWhitespace(node.getAttribute(SOFT_BREAK_INDENT_ATTRIBUTE));
  return `${space}\n${indentToWrite(node, indent)}`;
}

/**
 * Registered by `serialize.ts`, which is over the module size guideline.
 * `inCell` answers whether a table cell is being written: the serializer
 * writes a cell from its inner HTML alone, where the cell is no ancestor to
 * find, so it says so itself.
 */
export function addSoftBreakRules(turndown: TurndownService, inCell: () => boolean): void {
  turndown.addRule('softBreak', {
    filter: (node) =>
      node.nodeName === 'BR' && (node as HTMLElement).hasAttribute(SOFT_BREAK_ATTRIBUTE),
    replacement: (_content, node) => softBreakReplacement(node as HTMLElement, inCell()),
  });
}
