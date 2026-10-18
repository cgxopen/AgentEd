import { Marked, marked, type Token } from 'marked';

/**
 * No backslash inside a bare URL GitHub reads as a link, or on the character
 * right before or after one (#605, owner decision 1 of 2026-10-18).
 *
 * A bare URL is text in the editor, since `parse.ts` turns the GFM autolink
 * literal off (R-C13), so the escape treats it as any text: `faq#_how` is
 * written `faq#\_how`, a bracket in a path `/\[x\]`. Both readers agree the
 * text holds no syntax there, but GitHub runs the autolink literal and takes
 * the backslash into the address, `%5C`. Measured on the step zero, comment
 * 6245904403: 16 corpus files (13 distinct). A bracket right before a URL is
 * the same shape from outside: GitHub links no URL after a bare `[` or `]`,
 * and does after an escaped one.
 *
 * ── Asked of a reader, confirmed by the other ──
 *
 * Where a URL stands is asked of a second `Marked` with the autolink literal
 * on, once per text node holding `://`, `www.` or `@`, the starts its
 * tokenizer has; nothing is added to the build. Each backslash the escape
 * writes there is held as a stand-in, and answered once the document is
 * assembled: a block is read by the `marked` of `parse.ts` with the stand-ins
 * bare and with them as backslashes, and the backslash goes where the reading
 * moves, since an underscore left bare in a URL can still pair with one
 * outside it for the editor. The stand-in sits where the backslash will, so
 * every offset the escape and the rules after it count is unchanged.
 */

/** Stands where the escape wrote a backslash it may withhold. A private-use character, as in `escape.ts`. */
const WITHHELD = '';

/** Unless the document carries the stand-in itself (#425): then every backslash is written. */
let withholding = true;

/** Set whether stand-ins are made, and return the value it held, for the caller to restore. */
export function setWithholding(value: boolean): boolean {
  const previous = withholding;
  withholding = value;
  return previous;
}

/** The character this module stands in with, for the document check in `serialize.ts`. */
export const AUTOLINK_LITERAL_MARK = WITHHELD;

/** The starts the autolink literal tokenizer of `marked` has; a text node with none holds no URL. */
const MAY_HOLD_A_URL = /:\/\/|www\.|@/i;

/** `marked` with the GFM autolink literal on, as GitHub reads text. Never configured further. */
const gfmReader = new Marked({ gfm: true });

/** The most tokens of one text node walked for URLs; a bound on the walk. */
const MAX_TOKENS = 10000;

/** The [start, end) ranges of `text` the GFM autolink literal reads as a link. */
function autolinkLiteralRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let walked = 0;
  const walk = (tokens: readonly Token[], base: string, offset: number): void => {
    let cursor = 0;
    for (const token of tokens) {
      walked += 1;
      if (walked > MAX_TOKENS) return;
      const at = base.indexOf(token.raw, cursor);
      if (at < 0) continue;
      cursor = at + token.raw.length;
      const start = offset + at;
      if (token.type === 'link' && !/^[[<]/.test(token.raw)) {
        ranges.push([start, start + token.raw.length]);
      } else if ('tokens' in token && Array.isArray(token.tokens)) {
        walk(token.tokens as Token[], token.raw, start);
      }
    }
  };
  walk(gfmReader.Lexer.lexInline(text, gfmReader.defaults), text, 0);
  return ranges;
}

/**
 * `escaped` with each backslash the escape inserted inside or beside a URL of
 * `text` turned into the stand-in. `escaped` is `text` with characters put in
 * and none taken out, which is what the escape does; a `<` or a `&` keeps its
 * backslash, since that one is asked of the reader already (#565).
 */
function markWithheld(text: string, escaped: string, ranges: Array<[number, number]>): string {
  const beside = (i: number) => ranges.some(([start, end]) => i >= start - 1 && i <= end);
  let out = '';
  let i = 0;
  for (let j = 0; j < escaped.length; j += 1) {
    const character = escaped[j];
    if (i < text.length && character === text[i]) {
      out += character;
      i += 1;
      continue;
    }
    const withhold = character === '\\' && text[i] !== '<' && text[i] !== '&' && beside(i);
    out += withhold ? WITHHELD : character;
  }
  return out;
}

/** The escape of turndown wrapped, so a backslash in or beside a URL is held as a stand-in. */
export function withAutolinkLiterals(
  escapeText: (text: string) => string,
): (text: string) => string {
  return (text: string): string => {
    const escaped = escapeText(text);
    if (!withholding || !MAY_HOLD_A_URL.test(text) || !escaped.includes('\\')) return escaped;
    const ranges = autolinkLiteralRanges(text);
    return ranges.length === 0 ? escaped : markWithheld(text, escaped, ranges);
  };
}

/** A fence line: a block holding one is written with every backslash, the safe direction. */
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/m;

/** A reference definition, read beside each block so a label resolves as in the document. */
const DEFINITION_LINE = /^ {0,3}\[[^\]\n]{1,999}\]:[^\n]*$/gm;

/** The attributes the parse stamps for the serializer, which carry bytes rather than reading. */
const STAMPED = / data-[a-z-]+="[^"]*"/g;

/** The most stand-ins of one block tried one at a time; past it they are written as backslashes. */
const MAX_TRIES = 64;

function reads(block: string, definitions: string): string {
  return (marked.parse(`${block}${definitions}`, { async: false }) as string).replace(STAMPED, '');
}

/** Each stand-in of one block: bare where `marked` reads the block the same, a backslash where it does not. */
function answerBlock(block: string, definitions: string): string {
  const escapedAll = block.replaceAll(WITHHELD, '\\');
  if (FENCE_LINE.test(block)) return escapedAll;
  const target = reads(escapedAll, definitions);
  const bare = block.replaceAll(WITHHELD, '');
  if (reads(bare, definitions) === target) return bare;
  const parts = block.split(WITHHELD);
  const keep: boolean[] = parts.slice(1).map(() => false);
  const build = () => parts.reduce((all, part, k) => all + (keep[k - 1] ? '' : '\\') + part);
  for (let k = 0; k < keep.length && k < MAX_TRIES; k += 1) {
    keep[k] = true;
    if (reads(build(), definitions) !== target) keep[k] = false;
  }
  return build();
}

/**
 * Every stand-in of the assembled `markdown` answered, and none left. A block
 * runs from a line after a blank one that starts at the left margin, so an
 * item or a quote continued after a blank line is read with its container,
 * to the next blank line.
 */
export function answerAutolinkLiterals(markdown: string): string {
  // A stand-in in a document that carries the character is the person's own (#425).
  if (!withholding || !markdown.includes(WITHHELD)) return markdown;
  const definitions = `\n\n${(markdown.match(DEFINITION_LINE) ?? []).join('\n')}\n`;
  const lines = markdown.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].includes(WITHHELD)) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    let start = i;
    while (start > 0 && !(lines[start - 1].trim() === '' && /^\S/.test(lines[start]))) start -= 1;
    let end = i;
    while (end < lines.length && lines[end].trim() !== '') end += 1;
    const above = out.splice(out.length - (i - start), i - start);
    const block = [...above, ...lines.slice(i, end)].join('\n');
    out.push(...answerBlock(block, definitions).split('\n'));
    i = end;
  }
  return out.join('\n');
}
