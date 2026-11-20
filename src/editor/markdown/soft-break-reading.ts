import { markdownToHtml } from './parse';
import {
  decodeWhitespace,
  SOFT_BREAK_AS_READ_ATTRIBUTE,
  SOFT_BREAK_ATTRIBUTE,
  SOFT_BREAK_INDENT_ATTRIBUTE,
} from './soft-break';

/**
 * The indentation of a soft break in a list item, written as `marked` reads it
 * back (#757).
 *
 * `soft-break.ts` writes an indentation of four or more in a list item with
 * four more, since `marked` 15 takes four from such a line when it reads it.
 * After a nested list and a blank line it takes none: the paragraph there is
 * read whole, every space kept, so the four written back were kept at the next
 * read and every save added four more, without end. Measured on #757 over the
 * contexts of a list item: only that one reads every space.
 *
 * So the save asks the reader rather than a rule beside it. Each block at the
 * top of the document that holds a soft break in a list item with an
 * indentation of four or more is written alone and read again as a load reads
 * it; each such break that reads back with an indentation other than the one
 * it holds is marked to be written as held, with no four added, and the block
 * written alone with those marks is read again: the marks are kept only where
 * every soft break in a list item of the block then reads back as held. Where
 * any mark is kept, the document is written again with it. A document with no
 * such break is written once, as before.
 *
 * A block alone, not the whole document, because the indentation of a line in
 * a list item is read within its list; and the HTML is scanned as text, not
 * parsed into a tree: on the largest file of the census, 884 KB, reading the
 * whole document again took the test worker past its heap, measured on #757.
 */

/** A soft break holding an indentation of four or more, found before anything is scanned. */
const DEEP_INDENT = new RegExp(`${SOFT_BREAK_INDENT_ATTRIBUTE}="[st]{4,}"`);

/** The elements the HTML of the editor writes with no end tag. */
const VOID = new Set([
  'br',
  'hr',
  'img',
  'wbr',
  'input',
  'col',
  'source',
  'area',
  'embed',
  'track',
]);

/** Every tag, in document order; a soft break opening is one of them. */
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?)\/?>/g;

/** The indentation a soft break opening carries, read off its attributes. */
const INDENT_IN = new RegExp(`${SOFT_BREAK_INDENT_ATTRIBUTE}="([st]*)"`);

/** Whether the attributes of a `span` make it a soft break. */
const IS_BREAK = new RegExp(`^\\s${SOFT_BREAK_ATTRIBUTE}=""`);

interface Break {
  /** Where the opening tag of the break ends in the HTML, to place a mark before it. */
  readonly end: number;
  readonly inItem: boolean;
  readonly indent: string;
}

interface Block {
  readonly from: number;
  readonly to: number;
  readonly breaks: Break[];
}

/**
 * The blocks at the top of `html`, each with its soft breaks, whether a list
 * item holds each nearest, and its indentation. One pass over the tags.
 */
function blocksOf(html: string): Block[] {
  const blocks: Block[] = [];
  const open: string[] = [];
  let from = -1;
  let breaks: Break[] = [];
  for (const match of html.matchAll(TAG)) {
    const [tag, closing, rawName, attributes] = match;
    const name = rawName.toLowerCase();
    if (closing === '') {
      if (open.length === 0) {
        from = match.index;
        breaks = [];
      }
      if (name === 'span' && IS_BREAK.test(attributes ?? '')) {
        const nearest = open.findLast((n) => n === 'li' || n === 'blockquote');
        breaks.push({
          end: match.index + tag.length,
          inItem: nearest === 'li',
          indent: decodeWhitespace(INDENT_IN.exec(attributes ?? '')?.[1] ?? null),
        });
      }
      if (!VOID.has(name) && !tag.endsWith('/>')) open.push(name);
      else if (open.length === 0) blocks.push({ from, to: match.index + tag.length, breaks });
      continue;
    }
    const at = open.lastIndexOf(name);
    if (at < 0) continue;
    open.length = at;
    if (open.length === 0) blocks.push({ from, to: match.index + tag.length, breaks });
  }
  return blocks;
}

/** The indentations of the soft breaks in list items of `html`, in document order. */
function itemIndents(html: string): string[] {
  return blocksOf(html).flatMap((block) =>
    block.breaks.filter((b) => b.inItem).map((b) => b.indent),
  );
}

/** `html` with the mark written into the opening tag of each break of `breaks` chosen. */
function withMarks(html: string, offset: number, breaks: Break[]): string {
  let out = '';
  let at = 0;
  for (const b of breaks) {
    const end = b.end - offset - 1;
    out += `${html.slice(at, end)} ${SOFT_BREAK_AS_READ_ATTRIBUTE}=""`;
    at = end;
  }
  return out + html.slice(at);
}

/** The breaks of `block` to write as held, where its text alone reads them otherwise; none if it cannot tell. */
function breaksToMark(html: string, block: Block, write: (html: string) => string): Break[] {
  const source = html.slice(block.from, block.to);
  const items = block.breaks.filter((b) => b.inItem);
  const held = items.map((b) => b.indent);
  const read = itemIndents(markdownToHtml(write(source)));
  // Paired by order: a block that reads back with another number of breaks in
  // list items cannot be paired, and is written as before.
  if (read.length !== held.length) return [];
  const chosen = items.filter((b, i) => b.indent.length >= 4 && read[i] !== b.indent);
  if (chosen.length === 0) return [];
  const again = itemIndents(markdownToHtml(write(withMarks(source, block.from, chosen))));
  const holds = again.length === held.length && again.every((indent, i) => indent === held[i]);
  return holds ? chosen : [];
}

/** `html`, written by `write`, with each soft break in a list item written as `marked` reads it. */
export function withItemIndentsAsRead(html: string, write: (html: string) => string): string {
  if (!DEEP_INDENT.test(html)) return write(html);
  const chosen: Break[] = [];
  for (const block of blocksOf(html)) {
    if (!block.breaks.some((b) => b.inItem && b.indent.length >= 4)) continue;
    chosen.push(...breaksToMark(html, block, write));
  }
  return write(chosen.length === 0 ? html : withMarks(html, 0, chosen));
}
