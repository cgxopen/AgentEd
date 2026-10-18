/**
 * A strikethrough over a link and the text beside it, written around both
 * (#572, owner decision 3 of 2026-10-18).
 *
 * The link mark is the outermost, so a strikethrough covering a link and the
 * text after it was written inside the link and again beside it, the
 * exception of R-C2 for overlapping marks: `## ~~[v0.15.0] - 2024-10-01~~`
 * came back `## [~~v0.15.0~~][v0.15.0] ~~- 2024-10-01~~`, and the text beside
 * the link then opened a node with a hyphen, escaped on the second save,
 * 3 corpus files (3 distinct). Two struck links touching, `~~[a](/u)~~~~[b](/u)~~`,
 * which every reader reads as one strikethrough over both and the tildes
 * between, came back `[~~a~~](/u)~~\~~~~~~[~~b~~](/u)` and lost the second link.
 *
 * So where a link holds nothing but a strikethrough and a strikethrough stands
 * beside it, the strikethrough is lifted around the link and joined to the one
 * beside it, as the file wrote it. `second-save-repairs.ts` keeps the result
 * only where `marked` reads it back as the block.
 */

const STRIKE = new Set(['S', 'DEL', 'STRIKE']);

/** The strikethrough a link holds alone, or `null`. */
function struckWhole(link: Element): Element | null {
  const children = Array.from(link.childNodes).filter(
    (node) => node.nodeType !== 3 || (node.textContent ?? '') !== '',
  );
  const only = children[0];
  return children.length === 1 && only !== undefined && STRIKE.has(only.nodeName)
    ? (only as Element)
    : null;
}

function isStrike(node: Node | null): node is Element {
  return node !== null && STRIKE.has(node.nodeName);
}

/** The links of `block` this repair would lift a strikethrough around. */
function candidates(block: Element): Element[] {
  return Array.from(block.querySelectorAll('a')).filter(
    (link) =>
      struckWhole(link) !== null &&
      (isStrike(link.previousSibling) ||
        isStrike(link.nextSibling) ||
        (link.nextSibling?.nodeName === 'A' && struckWhole(link.nextSibling as Element) !== null)),
  );
}

export function holdsStrikeBesideLink(block: Element): boolean {
  return candidates(block).length > 0;
}

/** The repair, made on `block` in place: each strikethrough lifted, then neighbours joined. */
export function writeStrikeAroundLinks(block: Element): void {
  for (const link of candidates(block)) {
    const strike = struckWhole(link);
    if (strike === null) continue;
    const lifted = strike.cloneNode(false) as Element;
    while (strike.firstChild) link.insertBefore(strike.firstChild, strike);
    strike.remove();
    link.replaceWith(lifted);
    lifted.appendChild(link);
  }
  for (const strike of Array.from(block.querySelectorAll('s, del, strike'))) {
    let next = strike.nextSibling;
    while (isStrike(next) && next.parentNode === strike.parentNode) {
      while (next.firstChild) strike.appendChild(next.firstChild);
      const done = next;
      next = next.nextSibling;
      done.remove();
    }
  }
}
