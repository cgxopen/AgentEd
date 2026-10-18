import { BR_SPELLING_ATTRIBUTE } from './br-spelling';

/**
 * Hard breaks written so the next read holds them where the block holds
 * them (#572, owner decision 3 of 2026-10-18).
 *
 * A raw HTML block of images, `sup` and `br`, drawn as a paragraph, holds
 * breaks a markdown line cannot spell as two spaces: a break ending the block
 * was written as two spaces the next read drops, and two breaks in a row as a
 * line of spaces, which is a blank line and ends the paragraph. Each moved on
 * the second save, 16 corpus files (10 distinct) after the route of head 1.
 *
 * So, in a block holding such a break: a break opening or ending the block is
 * taken out, since CommonMark reads none there, and so are the spaces opening
 * its first text; a break that follows a break is spelled
 * with a backslash, the spelling #584 carries, which a line of its own can
 * hold; and the spaces opening a line after a break are taken out, since the
 * next read drops them. A break the file spelled carries its spelling and is
 * left alone. `second-save-repairs.ts` keeps the result only where `marked`
 * reads it back as the block.
 */

/** The most nodes of one block walked; a bound on the walk. */
const MAX_NODES = 20000;

function walk(block: Element): Node[] {
  const out: Node[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (
    let node = walker.nextNode();
    node !== null && out.length < MAX_NODES;
    node = walker.nextNode()
  ) {
    out.push(node);
  }
  return out;
}

const isBreak = (node: Node): boolean =>
  node.nodeName === 'BR' && !(node as Element).hasAttribute(BR_SPELLING_ATTRIBUTE);
const isBlank = (node: Node): boolean =>
  node.nodeType === 3 && (node.textContent ?? '').trim() === '';
// Any element counts, an empty anchor among them: GitHub draws a break before one.
const holdsSomething = (node: Node): boolean =>
  (node.nodeType === 3 && !isBlank(node)) || node.nodeType === 1;

/** The first node of `block` that holds something, a break included. */
function firstHeld(nodes: Node[]): Node | undefined {
  return nodes.find(holdsSomething);
}

/** Inline elements a block can open with around its first text: walked through. */
const WRAPPERS = new Set([
  'A',
  'STRONG',
  'B',
  'EM',
  'I',
  'S',
  'DEL',
  'SPAN',
  'SUP',
  'SUB',
  'KBD',
  'U',
]);

/** The text nodes of spaces alone the block opens with, inside its opening inline elements too. */
function leadingBlanks(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    if (node.nodeType === 3) {
      if ((node.textContent ?? '').trim() !== '') break;
      if ((node.textContent ?? '') !== '') out.push(node);
      continue;
    }
    if (!WRAPPERS.has(node.nodeName)) break;
  }
  return out;
}

/** The first text node holding a character, where only opening inline elements stand before it. */
function openingText(nodes: Node[]): Node | undefined {
  for (const node of nodes) {
    if (node.nodeType === 3) {
      if ((node.textContent ?? '').trim() !== '') return node;
      continue;
    }
    if (!WRAPPERS.has(node.nodeName)) return undefined;
  }
  return undefined;
}

/** Whether `block` opens with a break or with spaces, neither of which the next read holds. */
function opensWithSpace(nodes: Node[]): boolean {
  const first = firstHeld(nodes);
  return (
    (first !== undefined && isBreak(first)) ||
    /^[ \t]/.test(openingText(nodes)?.textContent ?? '') ||
    leadingBlanks(nodes).length > 0
  );
}

/**
 * The spaces ending a link around an image: drawn between two linked images,
 * turndown wrote them before the first link of the block instead, a space
 * opening the paragraph that the next read drops.
 */
function spacesEndingImageLinks(block: Element): Node[] {
  return Array.from(block.querySelectorAll('a'))
    .filter((link) => link.querySelector('img') !== null)
    .map((link) => link.lastChild)
    .filter(
      (last): last is ChildNode =>
        last !== null && isBlank(last) && (last.textContent ?? '') !== '',
    );
}

/** Whether `block` holds a break this repair would write otherwise. */
export function holdsBreakRun(block: Element): boolean {
  if (spacesEndingImageLinks(block).length > 0) return true;
  const nodes = walk(block);
  if (opensWithSpace(nodes)) return true;
  return nodes.some((node, i) => {
    if (!isBreak(node)) return false;
    const after = nodes.slice(i + 1).filter((n) => holdsSomething(n) && !isBreak(n));
    const before = nodes.slice(0, i).filter((n) => holdsSomething(n));
    const next = nodes[i + 1];
    return (
      after.length === 0 ||
      before[before.length - 1]?.nodeName === 'BR' ||
      (next?.nodeType === 3 && /^[ \t]/.test(next.textContent ?? ''))
    );
  });
}

/** The repair, made on `block` in place. */
export function writeBreakRuns(block: Element): void {
  for (const space of spacesEndingImageLinks(block)) space.parentElement?.after(space);
  let nodes = walk(block);
  // Breaks opening the block, and the spaces opening its first text, are not read.
  for (
    let first = firstHeld(nodes);
    first !== undefined && isBreak(first);
    first = firstHeld(nodes)
  ) {
    first.parentNode?.removeChild(first);
    nodes = walk(block);
  }
  for (const blank of leadingBlanks(nodes)) blank.textContent = '';
  const opening = firstHeld(nodes);
  if (opening?.nodeType === 3)
    opening.textContent = (opening.textContent ?? '').replace(/^[ \t]+/, '');
  nodes.forEach((node, i) => {
    if (!isBreak(node)) return;
    const after = nodes.slice(i + 1).filter((n) => holdsSomething(n) && !isBreak(n));
    if (after.length === 0) {
      node.parentNode?.removeChild(node);
      return;
    }
    const before = nodes.slice(0, i).filter(holdsSomething);
    if (before[before.length - 1]?.nodeName === 'BR') {
      (node as Element).setAttribute(BR_SPELLING_ATTRIBUTE, '\\');
    }
    const next = nodes[i + 1];
    if (next?.nodeType === 3) next.textContent = (next.textContent ?? '').replace(/^[ \t]+/, '');
  });
}
