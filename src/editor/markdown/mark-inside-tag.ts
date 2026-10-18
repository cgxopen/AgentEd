/**
 * An emphasis over the whole of a `sup`, `sub` or `kbd`, written inside the
 * tag where a delimiter outside it cannot open or close (#572, owner decision
 * 3 of 2026-10-18).
 *
 * The emphasis mark ranks above the tag, so `2<sup>*Δ*</sup>` was written
 * `2*<sup>Δ</sup>*`, whose star after a digit opens nothing: the next read held
 * literal stars, escaped on the second save, 1 corpus file. So where the
 * emphasis holds the tag alone and a letter or a digit stands against it, the
 * emphasis is written inside the tag, as the file wrote it.
 * `second-save-repairs.ts` keeps it only where `marked` reads it back as the
 * block.
 */

const EMPHASES = new Set(['EM', 'I', 'STRONG', 'B']);
const TAGS = new Set(['SUP', 'SUB', 'KBD']);
const WORD = /[\p{L}\p{N}]/u;

function lastCharacter(node: Node | null): string {
  const text = node?.textContent ?? '';
  return text.slice(-1);
}

function candidates(block: Element): Element[] {
  return Array.from(block.querySelectorAll('em, i, strong, b')).filter((element) => {
    if (!EMPHASES.has(element.nodeName) || element.childNodes.length !== 1) return false;
    if (!TAGS.has(element.firstChild?.nodeName ?? '')) return false;
    const before = lastCharacter(element.previousSibling);
    const after = (element.nextSibling?.textContent ?? '').slice(0, 1);
    return WORD.test(before) || WORD.test(after);
  });
}

export function holdsMarkOverTag(block: Element): boolean {
  return candidates(block).length > 0;
}

/** The repair, made on `block` in place: the tag outside, the emphasis inside it. */
export function writeMarkInsideTag(block: Element): void {
  for (const emphasis of candidates(block)) {
    const tag = emphasis.firstChild as Element;
    const inner = emphasis.cloneNode(false) as Element;
    while (tag.firstChild) inner.appendChild(tag.firstChild);
    tag.appendChild(inner);
    emphasis.replaceWith(tag);
  }
}
