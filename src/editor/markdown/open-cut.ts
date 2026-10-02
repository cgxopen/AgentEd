import type { Token } from 'marked';
import { htmlBlockEnd } from './html-block-end';
import { lexMarkdown } from './parse';
import { isWholeHtmlTable } from './table-html-source';
import { holdsFilteredTag } from './tag-filter';

/**
 * A raw HTML block that would cut the document at open (#455).
 *
 * CommonMark ends an HTML block at a blank line, or at the end of the
 * container it sits in. When the block ends while the HTML tokenizer is still
 * inside a quoted attribute value, or inside a comment, the HTML parser reads
 * everything after it as part of that value or that comment, up to the next
 * raw quote, the next `-->` or the end of the document, and what it read is
 * gone from the document the editor opens. Measured on #453 and #455: 96 bytes
 * of file opened as 17, and a save wrote the 17 over the file. **A third face
 * of the same blank line** (#457 review): words standing inside a tag after a
 * blank line, which `marked` keeps in the block, are read as attribute names
 * and are gone too. `html-block-end.ts` reads where the tokenizer stands.
 *
 * **The question is asked of the tokens, not of an HTML parser.** The parser
 * of the test harness and the one that ships disagree exactly here - happy-dom
 * keeps an element whose attribute never closes, as text, where Chromium drops
 * it - so a detector that asked the parser could not be tested for the build
 * the person runs. Where the tokenizer stands at the end of a block is the
 * same in both.
 *
 * **A block with nothing after it is not a cut**: it can take nothing but its
 * own text, which is what the recorded exceptions already say of it.
 */
export type OpenCutKind = 'attribute' | 'comment';

export interface OpenCut {
  /** The line of the file, counted from 1, where the cut begins. */
  readonly line: number;
  readonly kind: OpenCutKind;
}

/**
 * Whether some line opens, after the markers and indentation of the
 * containers it sits in, with a tag or a comment - which every HTML block
 * does. **It decides only whether to lex, and must never skip a file the
 * detector would refuse** (owner decision of 2026-10-01 on #455): a block can
 * begin after `>`, after a list marker, after a task box, and after any
 * indentation, so all of those are allowed in front of the `<`. Each
 * alternative of the loop takes characters no other one takes, so the scan of
 * a line is linear in its length.
 */
const LINE_OPENS_WITH_TAG =
  /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])(?=[ \t])|\[[ xX]\](?=[ \t]))*<[A-Za-z/!?]/m;

export function mayHoldOpenCut(markdown: string): boolean {
  return LINE_OPENS_WITH_TAG.test(markdown);
}

interface Placed {
  readonly token: Token;
  /** The top-level token it sits in, and the line that one starts on. */
  readonly top: Token;
  readonly topLine: number;
}

/**
 * Every block token in document order, each with the top-level token holding
 * it. A worklist rather than recursion, since how deep a document nests is the
 * file's to decide (the #20 census measured it unbounded); each token is
 * visited once.
 */
function blocksInOrder(tokens: Token[]): Placed[] {
  const placed: Placed[] = [];
  let line = 1;
  for (const top of tokens) {
    const stack: Token[] = [top];
    while (stack.length > 0) {
      const token = stack.pop() as Token;
      placed.push({ token, top, topLine: line });
      const children: Token[] =
        token.type === 'blockquote'
          ? (token.tokens ?? [])
          : token.type === 'list'
            ? token.items
            : token.type === 'list_item'
              ? (token.tokens ?? [])
              : [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    line += (top.raw.match(/\n/g) ?? []).length;
  }
  return placed;
}

const CONTAINERS = new Set(['space', 'blockquote', 'list', 'list_item']);

/** The line of `token` inside the top-level token that holds it. */
function lineOf(entry: Placed): number {
  if (entry.token === entry.top) return entry.topLine;
  const first = entry.token.raw.split('\n')[0].trim();
  const at = entry.top.raw.split('\n').findIndex((l) => l.includes(first));
  return entry.topLine + Math.max(at, 0);
}

/**
 * The first block that would cut the document at open, or `null`. The line is
 * counted in `markdown`, which the caller places in the file. The filter
 * decides whether the tokens are read at all.
 */
export function findOpenCut(markdown: string): OpenCut | null {
  return mayHoldOpenCut(markdown) ? openCutIn(markdown) : null;
}

/**
 * The same answer with no filter in front of it, so a test can ask whether the
 * filter would have let through every file this refuses.
 */
export function openCutIn(markdown: string): OpenCut | null {
  const placed = blocksInOrder(lexMarkdown(markdown) as Token[]);
  let lastContent = -1;
  for (let i = 0; i < placed.length; i++) {
    const { token } = placed[i];
    if (!CONTAINERS.has(token.type) && token.raw.trim() !== '') lastContent = i;
  }
  for (let i = 0; i < lastContent; i++) {
    const { raw } = placed[i].token;
    if (placed[i].token.type !== 'html') continue;
    // A block holding a name of the GFM tag filter is shown as a paragraph of
    // its own text and keeps its bytes (#461): its markup is read apart from
    // the document, so it can take nothing after it. A whole raw table is the
    // exception, drawn from its filtered markup in the document as before.
    if (holdsFilteredTag(raw) && !isWholeHtmlTable(raw)) continue;
    const end = htmlBlockEnd(raw);
    // Words a tag swallowed as attribute names are the attribute shape seen
    // from the other side (#457 review): the repair is the same blank line.
    if (end.state === 'quote' || end.wordsAfterBlankLineInTag) {
      return { line: lineOf(placed[i]), kind: 'attribute' };
    }
    if (end.state === 'comment') return { line: lineOf(placed[i]), kind: 'comment' };
  }
  return null;
}
