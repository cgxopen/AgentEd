import type { Token } from 'marked';
import { htmlBlockEnd } from './html-block-end';
import { lexMarkdown } from './parse';

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
export type OpenCutKind = 'attribute' | 'comment' | 'raw-text';

export interface OpenCut {
  /** The line of the file, counted from 1, where the cut begins. */
  readonly line: number;
  readonly kind: OpenCutKind;
  /** For `raw-text`, the element left open, which the repair names (#458). */
  readonly element?: string;
}

/**
 * The raw-text elements whose text, left open, takes what follows with it
 * (#458), measured in Chromium through the editor. `textarea` is the one left
 * out: its text survives, folded into the field, so it is not a cut.
 */
const CUTTING_RAW_TEXT = new Set([
  'script',
  'style',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
]);

/**
 * Whether a `script` or a `style` left open at the top level runs on past a
 * blank line (#458). Their block runs to the end of the file, so nothing
 * follows it for the walk to see, and what a reader takes for the next
 * paragraphs is the text of the element. The other elements end their block
 * at the blank line, where the text after it is a block of its own.
 */
const BLANK_LINE_THEN_TEXT = /\n[ \t]*\n[\s\S]*\S/;

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

function countLines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

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
  for (let i = 0; i < placed.length; i++) {
    if (placed[i].token.type !== 'html') continue;
    const end = htmlBlockEnd(placed[i].token.raw);
    const raw = end.rawText;
    if (raw && CUTTING_RAW_TEXT.has(raw.element)) {
      const textAfter = i < lastContent;
      const runsOn = /^(script|style)$/.test(raw.element) && BLANK_LINE_THEN_TEXT.test(raw.text);
      if (textAfter || runsOn) {
        const line = lineOf(placed[i]) + countLines(placed[i].token.raw.slice(0, raw.start));
        return { line, kind: 'raw-text', element: raw.element };
      }
    }
    if (i >= lastContent) continue;
    // Words a tag swallowed as attribute names are the attribute shape seen
    // from the other side (#457 review): the repair is the same blank line.
    if (end.state === 'quote' || end.wordsAfterBlankLineInTag) {
      return { line: lineOf(placed[i]), kind: 'attribute' };
    }
    if (end.state === 'comment') return { line: lineOf(placed[i]), kind: 'comment' };
  }
  return null;
}
