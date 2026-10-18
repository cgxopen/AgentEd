import { holdsBreakRun, writeBreakRuns } from './break-runs';
import { holdsEmphasisBesideStrong, writeEmphasisBesideStrong } from './emphasis-beside-strong';
import { holdsMarkOverTag, writeMarkInsideTag } from './mark-inside-tag';
import { definitionsOf, readsAsBlock } from './mark-reading';
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

/** Elements whose inline content is a block of its own. */
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li';

/**
 * What the HTML of a document holds before any of the four shapes can be in
 * it, tried before the document is parsed: a break; a block, or a link, opening
 * or ending with a space; a strikethrough next to a link; an emphasis and a
 * strong touching; an emphasis around a `sup`, a `sub` or a `kbd`. Most
 * documents hold none, and are not parsed here at all.
 */
const MAY_HOLD_A_SHAPE =
  /<br[\s>/]|<(?:p|h[1-6]|li)(?:\s[^>]*)?>(?:<[^>]+>)*[ \t]|[ \t]<\/a>|<\/a><(?:s|del)>|<\/(?:s|del)><a[\s>]|<a[^>]*><(?:s|del)>|<\/(?:strong|b|em|i)><(?:strong|b|em|i)[\s>]|<(?:em|i|strong|b)[^>]*><(?:sup|sub|kbd)[\s>]/i;

/** The markers the serializer writes and answers later: none is text, so none is read. */
const PRIVATE_USE = /[-]/g;

/** The most blocks of one document repaired; a bound on the work. */
const MAX_BLOCKS = 5000;

/** `html` with the blocks a repair reads back as themselves written that way, or `html` itself. */
export function withSecondSaveRepairs(html: string, write: (html: string) => string): string {
  if (!MAY_HOLD_A_SHAPE.test(html)) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const blocks = Array.from(template.content.querySelectorAll(BLOCKS)).filter(
    (block) => block.querySelector(BLOCKS) === null,
  );
  let definitions: string | null = null;
  let changed = 0;
  for (const block of blocks.slice(0, MAX_BLOCKS)) {
    let applicable = REPAIRS.filter(([holds]) => holds(block));
    if (applicable.length === 0) continue;
    definitions ??= definitionsOf(template.content);
    if (applicable.some(([, , onlyWhereWrong]) => onlyWhereWrong)) {
      const today = write(block.outerHTML).replace(PRIVATE_USE, '');
      if (readsAsBlock(today, block, definitions)) {
        applicable = applicable.filter(([, , onlyWhereWrong]) => !onlyWhereWrong);
      }
      if (applicable.length === 0) continue;
    }
    const copy = block.cloneNode(true) as Element;
    for (const [, repair] of applicable) repair(copy);
    const written = write(copy.outerHTML).replace(PRIVATE_USE, '');
    if (!readsAsBlock(written, block, definitions)) continue;
    block.replaceWith(copy);
    changed += 1;
  }
  return changed === 0 ? html : template.innerHTML;
}
