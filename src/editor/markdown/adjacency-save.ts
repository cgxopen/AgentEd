/**
 * Two adjacent blocks written back adjacent, where they still read as the
 * same two blocks (#568, owner decisions D1 and D3).
 *
 * `adjacency.ts` puts `data-adjacent` on a block the file wrote directly
 * under another. turndown writes every block a blank line apart, so the
 * blank line is taken out afterwards, in three steps.
 *
 * ── 1. Marks, during the walk ──
 *
 * Every rule is reached through `rules.forNode`, so one wrapper there marks
 * every block whatever rule writes it, and no rule changes. A flagged block
 * leads with `ADJACENT` and ends with `PAIR_END`; the block above it leads
 * with `PAIR_START`. Each mark carries the number of its pair, so a pair is
 * found again however deep its blocks are nested. The marks are private-use
 * characters, as the definition marks of #425 are, and the same step aside
 * applies: a document that carries one of them is written as before.
 *
 * ── 2. Each pair, read alone ──
 *
 * The two blocks of a pair are cut out of the written text with the
 * container prefix of their lines, and read by the block lexer twice, a
 * blank line apart and adjacent. The blank line goes only where both read
 * as the same blocks. This is the trap of the issue: `Text.` over `***` is
 * two blocks, but the rule is written `---`, and `Text.` over `---` is a
 * heading. Each pair is read once, so the cost grows with the document and
 * not with its square, which the step zero measured at 136 s for one save.
 *
 * ── 3. The whole document, once ──
 *
 * A pair read alone does not see the lines around it, so the document is
 * read once more, whole, against the document written with every blank
 * line. Where they differ, the document is written with every blank line,
 * as before #568, and its adjacency is given up rather than searched for:
 * owner decision D1, so a refused document costs this one read and no more.
 */
import type { Token, Tokens } from 'marked';
import type { Rule } from 'turndown';
import { ADJACENT_ATTRIBUTE } from './adjacency';
import { lexMarkdown } from './parse';

const ADJACENT = '';
const PAIR_START = '';
const PAIR_END = '';
const NUMBER_END = '';

const ANY_MARK = /[-]\d*?/g;

/** A blank line written before a flagged block: its two prefixes and the pair's number. */
const BLANK_LINE_BEFORE_A_PAIR = /\n([ \t>]*)\n([ \t>]*)(\d+)/g;

/** The most pairs one document is answered for; past it, the rest keep their blank line. */
const MAX_PAIRS = 1_000_000;

/** The elements of a written block, the only ones that carry or face a flag. */
const BLOCK = /^(?:P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|DIV)$/;

let marking = false;
let pairNumbers = new WeakMap<Element, number>();
let nextPairNumber = 0;

/**
 * Switch the marks on for one conversion, unless the document carries one
 * of their characters, and give back what was there before, so a conversion
 * made while another runs leaves the outer one as it found it.
 */
export function beginAdjacency(html: string): () => void {
  const outer = { marking, pairNumbers, nextPairNumber };
  marking = !/[-]/.test(html);
  pairNumbers = new WeakMap();
  nextPairNumber = 0;
  return () => {
    marking = outer.marking;
    pairNumbers = outer.pairNumbers;
    nextPairNumber = outer.nextPairNumber;
  };
}

/** Text with every adjacency mark taken out; a table cell holds none. */
export function withoutAdjacencyMarks(text: string): string {
  return marking ? text.replace(ANY_MARK, '') : text;
}

function pairNumber(element: Element): number {
  let number = pairNumbers.get(element);
  if (number === undefined) {
    number = nextPairNumber++;
    pairNumbers.set(element, number);
  }
  return number;
}

/** The rule, its output marked where the block carries the flag or faces one. */
function markedRule(rule: Rule, node: Node): Rule {
  if (!marking || node.nodeType !== Node.ELEMENT_NODE || !BLOCK.test(node.nodeName)) return rule;
  const element = node as Element;
  const below = element.nextElementSibling;
  const facing = below?.hasAttribute(ADJACENT_ATTRIBUTE) === true ? below : null;
  const flagged = element.hasAttribute(ADJACENT_ATTRIBUTE);
  if (facing === null && !flagged) return rule;
  return {
    filter: rule.filter,
    replacement: (content, replaced, options) => {
      let written = rule.replacement(content, replaced, options);
      if (written.trim() === '') return written;
      if (facing !== null) written = lead(written, `${PAIR_START}${pairNumber(facing)}`);
      if (flagged) {
        const number = pairNumber(element);
        written = lead(written, `${ADJACENT}${number}`).replace(
          /(\n*)$/,
          `${PAIR_END}${number}${NUMBER_END}$1`,
        );
      }
      return written;
    },
  };
}

const lead = (written: string, mark: string) => written.replace(/^(\n*)/, `$1${mark}${NUMBER_END}`);

/** Wrap turndown's rule lookup, so every block is marked whichever rule writes it. */
export function addAdjacencyMarks(service: { rules?: { forNode?: (node: Node) => Rule } }): void {
  const table = service.rules;
  const lookup = table?.forNode;
  if (table === undefined || lookup === undefined) {
    throw new Error(
      'turndown no longer exposes rules.forNode, so two adjacent blocks cannot be marked (#568). ' +
        'See src/editor/markdown/adjacency-save.ts.',
    );
  }
  table.forNode = (node: Node) => markedRule(lookup.call(table, node), node);
}

/**
 * The written document with the blank line taken out of each pair that
 * still reads as the same two blocks, through `finish`, the passes that
 * answer the other marks of the serializer. Every read is of finished text,
 * so the lexer reads what the file will hold.
 */
export function answerAdjacency(written: string, finish: (text: string) => string): string {
  if (!marking) return finish(written);
  const apart = finish(written.replace(ANY_MARK, ''));
  if (!written.includes(ADJACENT)) return apart;
  let joined = '';
  let at = 0;
  let pairs = 0;
  BLANK_LINE_BEFORE_A_PAIR.lastIndex = 0;
  for (
    let site = BLANK_LINE_BEFORE_A_PAIR.exec(written);
    site !== null && pairs < MAX_PAIRS;
    site = BLANK_LINE_BEFORE_A_PAIR.exec(written)
  ) {
    if (!readsTheSame(written, site, finish)) continue;
    joined += `${written.slice(at, site.index)}\n${site[2]}`;
    at = site.index + site[0].length;
    pairs += 1;
  }
  if (pairs === 0) return apart;
  const adjacent = finish(`${joined}${written.slice(at)}`.replace(ANY_MARK, ''));
  return shapeOf(adjacent) === shapeOf(apart) ? adjacent : apart;
}

/** Whether the pair at `site`, read alone, reads the same adjacent as apart. */
function readsTheSame(
  written: string,
  site: RegExpExecArray,
  finish: (text: string) => string,
): boolean {
  const number = site[3];
  const start = written.lastIndexOf(`${PAIR_START}${number}${NUMBER_END}`, site.index);
  const end = written.indexOf(`${PAIR_END}${number}${NUMBER_END}`, site.index);
  if (start === -1 || end === -1) return false;
  const lineStart = written.lastIndexOf('\n', start) + 1;
  const lineEnd = written.indexOf('\n', end);
  const pair = written.slice(lineStart, lineEnd === -1 ? written.length : lineEnd);
  const cut = site.index - lineStart;
  const prefix = written.slice(lineStart, start).replace(ANY_MARK, '');
  const apart = alone(pair, prefix);
  const adjacent = alone(
    `${pair.slice(0, cut)}\n${site[2]}${pair.slice(cut + site[0].length)}`,
    prefix,
  );
  if (apart === null || adjacent === null) return false;
  return shapeOf(finish(adjacent)) === shapeOf(finish(apart));
}

/**
 * The lines of a pair without the prefix of their container, or `null` when
 * a line does not carry it. The first line's prefix may hold a list marker,
 * which is the indentation of the lines after it.
 */
function alone(pair: string, prefix: string): string | null {
  const rest = prefix.replace(/[-*+](?= )|\d{1,9}[.)](?= )/g, (marker) =>
    ' '.repeat(marker.length),
  );
  if (!/^[ \t>]*$/.test(rest)) return null;
  const lines = pair.replace(ANY_MARK, '').split('\n');
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === 0) out.push(line.slice(prefix.length));
    else if (line.startsWith(rest)) out.push(line.slice(rest.length));
    else if (line.trimEnd() === rest.trimEnd()) out.push('');
    else return null;
  }
  return out.join('\n');
}

/** The deepest nesting `shapeOf` follows. */
const MAX_SHAPE_DEPTH = 100;

const flat = (text: unknown) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The blocks `markdown` reads as: their types, heading levels, list kinds
 * and starts, items and text. Blank lines are not in it, and neither is
 * whether a list is loose, since a blank line inside an item makes it so and
 * the list's own spacing is carried apart (#28).
 */
function shapeOf(markdown: string): string {
  return JSON.stringify(shapeOfTokens(lexMarkdown(markdown), 0));
}

function shapeOfTokens(tokens: Token[], depth: number): unknown[] {
  if (depth > MAX_SHAPE_DEPTH) return ['too deep'];
  const shape: unknown[] = [];
  for (const token of tokens) {
    if (token.type === 'space') continue;
    if (token.type === 'heading') shape.push(['h', token.depth, flat(token.text)]);
    else if (token.type === 'paragraph' || token.type === 'text')
      shape.push(['p', flat(token.text)]);
    else if (token.type === 'list') {
      const items = (token as Tokens.List).items.map((item) => [
        item.task,
        shapeOfTokens(item.tokens, depth + 1),
      ]);
      shape.push(['list', token.ordered, token.start, items]);
    } else if (token.type === 'blockquote')
      shape.push(['q', shapeOfTokens(token.tokens ?? [], depth + 1)]);
    else if (token.type === 'code')
      shape.push(['code', token.codeBlockStyle ?? 'fenced', token.text]);
    else shape.push([token.type, flat(token.raw)]);
  }
  return shape;
}
