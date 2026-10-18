import { marked } from 'marked';
import { REFERENCE_DEFINITION_ATTRIBUTE } from './reference';

/**
 * Whether markdown written for a block reads back with the text and the marks
 * the block holds (#572): the check the repairs of the second save ask of
 * `marked` before they write anything otherwise than before.
 *
 * Both sides are reduced to one string: each character of text with the
 * marks around it, a break as a line ending, white space runs as one space.
 * A break opening or ending the block and the spaces opening a line after a
 * break are not part of what the block holds, since CommonMark reads none.
 */

const MARKS: Readonly<Record<string, string>> = {
  STRONG: 'strong',
  B: 'strong',
  EM: 'em',
  I: 'em',
  S: 'del',
  DEL: 'del',
  STRIKE: 'del',
  CODE: 'code',
  A: 'link',
  SUP: 'sup',
  SUB: 'sub',
  KBD: 'kbd',
};

/** The most nodes of one block read; a block past it is not repaired. */
const MAX_NODES = 20000;

/** The marks of `node` up to `root`, in a stable order. */
function marksOf(node: Node, root: Node): string {
  const names: string[] = [];
  for (let at = node.parentNode; at !== null && at !== root; at = at.parentNode) {
    const mark = MARKS[at.nodeName];
    if (mark !== undefined) names.push(mark);
  }
  return names.sort().join('+');
}

/** `root` as text and marks, or `null` past the bound. */
export function markedText(root: Node): string | null {
  const tokens: { text: string; marks: string }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let count = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    count += 1;
    if (count > MAX_NODES) return null;
    if (node.nodeName === 'BR') tokens.push({ text: '\n', marks: '' });
    else if (node.nodeType === 3) {
      const marks = marksOf(node, root);
      for (const character of node.textContent ?? '') {
        tokens.push({ text: /[ \t\r\n]/.test(character) ? ' ' : character, marks });
      }
    }
  }
  const kept: { text: string; marks: string }[] = [];
  for (const token of tokens) {
    const last = kept[kept.length - 1];
    // A space after a break or at the start, or after another space, is not read.
    // A break opening the block is not read either.
    if (token.text === '\n' && last === undefined) continue;
    if (token.text === ' ' && (last === undefined || last.text === '\n' || last.text === ' '))
      continue;
    // Nor a space before a break.
    if (token.text === '\n' && last?.text === ' ') kept.pop();
    kept.push(token);
  }
  while (
    kept.length > 0 &&
    (kept[kept.length - 1].text === ' ' || kept[kept.length - 1].text === '\n')
  ) {
    kept.pop();
  }
  return kept.map((token) => (token.text === ' ' ? ' ' : `${token.text}${token.marks}|`)).join('');
}

/** The reference definitions the document holds, so a block read alone resolves its labels. */
export function definitionsOf(root: ParentNode): string {
  return Array.from(root.querySelectorAll(`[${REFERENCE_DEFINITION_ATTRIBUTE}]`))
    .map((element) => element.textContent ?? '')
    .join('\n');
}

/** Whether `markdown`, read by `marked` with `definitions` beside it, holds what `block` holds. */
export function readsAsBlock(markdown: string, block: Node, definitions: string): boolean {
  const expected = markedText(block);
  if (expected === null) return false;
  const template = document.createElement('template');
  template.innerHTML = marked.parse(`${markdown}\n\n${definitions}\n`, { async: false }) as string;
  for (const definition of Array.from(
    template.content.querySelectorAll(`[${REFERENCE_DEFINITION_ATTRIBUTE}]`),
  )) {
    definition.remove();
  }
  return markedText(template.content) === expected;
}
