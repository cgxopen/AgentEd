import { holdsBreakRun, writeBreakRuns } from './break-runs';
import { holdsEmphasisBesideStrong, writeEmphasisBesideStrong } from './emphasis-beside-strong';
import { holdsMarkOverTag, writeMarkInsideTag } from './mark-inside-tag';
import { definitionsOf, readsAsBlock } from './mark-reading';
import { REFERENCE_DEFINITION_ATTRIBUTE } from './reference';
import { holdsStrikeBesideLink, writeStrikeAroundLinks } from './strike-around-link';

/**
 * The four writer repairs of #572 (owner decision 3 of 2026-10-18), each a
 * shape the first save wrote so that the second wrote it otherwise: breaks
 * in a raw HTML block, a strikethrough split around a link, an emphasis
 * touching a strong one, and an emphasis over a `sup`.
 *
 * Each block holding one of them is copied, the repair made on the copy, and
 * the copy written alone and read back by `marked`: it is kept only where that
 * reading holds the text, the marks and the breaks the block holds
 * (`mark-reading.ts`), and the block is written as before otherwise. A block
 * holding none of them is not looked at.
 */

/**
 * Each repair, and whether it is made only where the block as written today
 * reads back otherwise: an emphasis beside a strong one is written today in a
 * spelling that reads back right in most places, and moves only where its
 * delimiters meet, so it is left alone wherever it reads right already.
 */
const REPAIRS: readonly [(block: Element) => boolean, (block: Element) => void, boolean][] = [
  [holdsBreakRun, writeBreakRuns, false],
  [holdsStrikeBesideLink, writeStrikeAroundLinks, false],
  [holdsEmphasisBesideStrong, writeEmphasisBesideStrong, true],
  [holdsMarkOverTag, writeMarkInsideTag, true],
];

/**
 * The blocks whose inline content is a block of its own, found in the HTML
 * rather than parsed: a paragraph or a heading, neither of which can hold
 * another. A list item and a table cell hold paragraphs in this schema, so
 * their text is always inside one. Each is checked below to be the element it
 * looks like before anything is done with it.
 */
const BLOCK = /<(p|h[1-6])(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi;

/**
 * What the HTML of a document holds before any of the four shapes can be in
 * it, tried before the document is parsed: a break; a block, or a link, opening
 * or ending with a space; a strikethrough next to a link; an emphasis and a
 * strong touching; an emphasis around a `sup`, a `sub` or a `kbd`. A block
 * opens with a space only through the inline elements `break-runs.ts` walks
 * through, so only those may stand before the space. Most documents hold
 * none, and are not parsed here at all.
 */
const MAY_HOLD_A_SHAPE =
  /<br[\s>/]|<(?:p|h[1-6])(?:\s[^>]*)?>(?:<\/?(?:a|strong|b|em|i|s|del|span|sup|sub|kbd|u)(?:\s[^>]*)?>)*[ \t]|[ \t]<\/a>|<\/a><(?:s|del)>|<\/(?:s|del)><a[\s>]|<a[^>]*><(?:s|del)>|<\/(?:strong|b|em|i)><(?:strong|b|em|i)[\s>]|<(?:em|i|strong|b)[^>]*><(?:sup|sub|kbd)[\s>]/i;

/** The markers the serializer writes and answers later: none is text, so none is read. */
const PRIVATE_USE = /[-]/g;

/** The most blocks of one document repaired; a bound on the work. */
const MAX_BLOCKS = 5000;

/** `source` parsed alone, where it is one element written back as itself; `null` otherwise. */
function parsedAlone(source: string): Element | null {
  const template = document.createElement('template');
  template.innerHTML = source;
  const element = template.content.firstElementChild;
  return template.content.childNodes.length === 1 && element?.outerHTML === source ? element : null;
}

/** The reference definitions of the whole document, parsed only where it holds one. */
function documentDefinitions(html: string): string {
  if (!html.includes(REFERENCE_DEFINITION_ATTRIBUTE)) return '';
  const template = document.createElement('template');
  template.innerHTML = html;
  return definitionsOf(template.content);
}

/** The block written with the repairs it holds, where `marked` reads that back as the block. */
function repairedBlock(
  block: Element,
  write: (html: string) => string,
  definitions: () => string,
): string | null {
  let applicable = REPAIRS.filter(([holds]) => holds(block));
  if (applicable.length === 0) return null;
  if (applicable.some(([, , onlyWhereWrong]) => onlyWhereWrong)) {
    const today = write(block.outerHTML).replace(PRIVATE_USE, '');
    if (readsAsBlock(today, block, definitions())) {
      applicable = applicable.filter(([, , onlyWhereWrong]) => !onlyWhereWrong);
    }
    if (applicable.length === 0) return null;
  }
  const copy = block.cloneNode(true) as Element;
  for (const [, repair] of applicable) repair(copy);
  const written = write(copy.outerHTML).replace(PRIVATE_USE, '');
  return readsAsBlock(written, block, definitions()) ? copy.outerHTML : null;
}

/** `html` with the blocks a repair reads back as themselves written that way, or `html` itself. */
export function withSecondSaveRepairs(html: string, write: (html: string) => string): string {
  if (!MAY_HOLD_A_SHAPE.test(html)) return html;
  let definitions: string | null = null;
  const lazyDefinitions = () => {
    definitions ??= documentDefinitions(html);
    return definitions;
  };
  let seen = 0;
  return html.replace(BLOCK, (source) => {
    seen += 1;
    if (seen > MAX_BLOCKS || !MAY_HOLD_A_SHAPE.test(source)) return source;
    const block = parsedAlone(source);
    if (block === null) return source;
    return repairedBlock(block, write, lazyDefinitions) ?? source;
  });
}
