import type TurndownService from 'turndown';

/**
 * An emphasis touching a strong emphasis, written with underscores (#572,
 * owner decision 3 of 2026-10-18).
 *
 * A raw `b`, an `i` and a `b` side by side, `<b>a</b><i>x</i><b>b</b>`, were
 * written `**a***x***b**`: the closing and opening runs met, and the next read
 * paired them otherwise, `*x*` on the second save, 1 corpus file. So an
 * emphasis whose neighbour is a strong emphasis is written with the delimiter
 * of #566, the underscore, whichever it carries, which no star run takes: written by a rule of its
 * own, since the underscore rule of #566 asks for no letter beside the
 * element, and here the neighbour is a delimiter run. `second-save-repairs.ts`
 * keeps it only where `marked` reads it back as the block.
 */

/** Set on the copy `second-save-repairs.ts` writes; never read from a document. */
const BESIDE_STRONG = 'data-beside-strong';

const EMPHASIS = new Set(['EM', 'I']);
const STRONG = new Set(['STRONG', 'B']);

function candidates(block: Element): Element[] {
  return Array.from(block.querySelectorAll('em, i')).filter(
    (element) =>
      EMPHASIS.has(element.nodeName) &&
      !element.hasAttribute(BESIDE_STRONG) &&
      (STRONG.has(element.previousSibling?.nodeName ?? '') ||
        STRONG.has(element.nextSibling?.nodeName ?? '')),
  );
}

export function holdsEmphasisBesideStrong(block: Element): boolean {
  return candidates(block).length > 0;
}

/** The repair, made on `block` in place. */
export function writeEmphasisBesideStrong(block: Element): void {
  for (const element of candidates(block)) element.setAttribute(BESIDE_STRONG, '');
}

/** Registered by `serialize.ts`: an emphasis marked by the repair, written with underscores. */
export function addEmphasisBesideStrongRule(turndown: TurndownService): void {
  turndown.addRule('emphasisBesideStrong', {
    filter: (node) =>
      EMPHASIS.has(node.nodeName) && (node as HTMLElement).hasAttribute(BESIDE_STRONG),
    replacement: (content) => (content.trim() === '' ? '' : `_${content}_`),
  });
}
