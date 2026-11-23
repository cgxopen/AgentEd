import { marked, type Token, type Tokens } from 'marked';

/**
 * A lazy line after a blank line in a list item continues the item (#758,
 * owner decision of 2026-11-23 on #758, route A).
 *
 * ── What was lost ──
 *
 * CommonMark lets a line that continues a paragraph leave out the indentation
 * of the item it stands in, wherever that paragraph stands in the item.
 * `marked` 15.0.12 keeps such a line only in the first paragraph of an item:
 * its list tokenizer sets a flag at the first blank line of an item and never
 * clears it, and a line indented less than the item then ends the item,
 * whatever stands right above it. So `1. One`, a blank line, `   Two` and
 * `lazy.` was read as a list and a paragraph after it, and the blocks of the
 * item after the lazy line, and the items after them, left the list: a fence
 * there ran to the end of the document, and the save wrote what the editor
 * showed.
 *
 * ── Asked of the reader, not restated ──
 *
 * The list tokenizer of `marked` is called as it is (`list-item-end.ts`).
 * Where the list it returns ends at a line that continues the paragraph its
 * last item ends with, it is called again with that line indented to the
 * item, which is how `marked` reads a line it keeps, and the spaces put in are
 * taken out of the raw of the list and of the item again, so the raw stays the
 * slice of the file. A nested list is tokenized inside the call and goes
 * through the same extension, so a lazy line of a nested item is indented
 * again there.
 *
 * The line continues the paragraph where every one of these holds:
 * - the last block of the last item, followed into a quote whose last line is
 *   not empty or into a last list item, is a paragraph (inside an item
 *   `marked` hands it as a `text` token);
 * - the line, lexed under a paragraph, continues it;
 * - no rule the tokenizer ends an item with matches it: a new marker, a rule,
 *   a fence, a heading, an HTML start or end tag (`endsTheItem`).
 * So a line inside an open fence of the item ends the item, as CommonMark
 * reads it; `marked` takes it into the code block from 17.0.2 on.
 *
 * The lazy lines of a run are indented in one round. Each round tokenizes the
 * list again from its start, so a list where many items hold a lazy line costs
 * a round per item: past `MAX_ROUNDS` rounds the rest of the list is read as
 * before, the bound R-C2 records.
 */

/** The most rounds for one list; past it the rest of the list is read as `marked` reads it. */
export const MAX_ROUNDS = 64;

/** What the extension is handed as `this`: the shared tokenizer, and its lexer. */
export interface ListTokenizing {
  lexer: unknown;
}

type ListToken = Tokens.List;

/** Whether the last block of `tokens`, followed into a quote or a last list item, is a paragraph. */
function endsInAParagraph(tokens: readonly Token[] | undefined, depth = 0): boolean {
  if (tokens === undefined || depth > 32) return false;
  let last: Token | undefined;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (tokens[i].type !== 'space') {
      last = tokens[i];
      break;
    }
  }
  if (last === undefined) return false;
  if (last.type === 'paragraph' || last.type === 'text') return true;
  if (last.type === 'blockquote') {
    // A quote line holding nothing closes the paragraph above it.
    const quoted = (last as Tokens.Blockquote).text.split('\n');
    if ((quoted.at(-1) ?? '').trim() === '') return false;
    return endsInAParagraph((last as Tokens.Blockquote).tokens, depth + 1);
  }
  if (last.type === 'list')
    return endsInAParagraph((last as ListToken).items.at(-1)?.tokens, depth + 1);
  return false;
}

/**
 * Whether `line` continues a paragraph, as the block lexer reads it. A lexer
 * made here takes the shared tokenizer over (`new Lexer` sets its `lexer`), so
 * it is given back whatever the lex returns, or the rest of the document is
 * lexed into this one.
 */
function continuesAParagraph(tokenizer: ListTokenizing, line: string): boolean {
  const own = tokenizer.lexer;
  try {
    const tokens = marked.Lexer.lex(`p\n${line}\n`, marked.defaults);
    return tokens.length === 1 && tokens[0].type === 'paragraph';
  } finally {
    tokenizer.lexer = own;
  }
}

/** The column the content of an item stands at, read off its first line as `marked` reads it. */
function contentColumn(raw: string): number {
  const marker = /^( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t]*)/.exec(raw);
  if (marker === null) return 0;
  const gap = marker[2].length;
  return marker[1].length + (gap === 0 || gap > 4 ? 1 : gap);
}

/** The most lines of one run looked at in a round. */
const MAX_RUN = 100000;

/**
 * The lines right after the list, each indented less than the content of the
 * item, that continue the paragraph its last item ends with, each with the
 * offset in `src` it starts at.
 */
function lazyRun(
  tokenizer: ListTokenizing,
  src: string,
  from: number,
  indent: number,
  endsTheItem: (line: string, indent: number) => boolean,
): Array<[number, string]> {
  const run: Array<[number, string]> = [];
  let at = src[from] === '\n' ? from + 1 : from;
  while (at < src.length && run.length < MAX_RUN) {
    const end = src.indexOf('\n', at);
    const line = src.slice(at, end === -1 ? src.length : end);
    // A line indented to the item is the tokenizer's own; the run is the lines short of it.
    const lead = line.length - line.replace(/^ +/, '').length;
    if (line.trim() === '' || lead >= indent) break;
    if (endsTheItem(line, indent) || !continuesAParagraph(tokenizer, line)) break;
    run.push([at, line]);
    if (end === -1) break;
    at = end + 1;
  }
  return run;
}

/** `raw`, which starts at `start` of the source as indented, with the spaces put in taken out. */
function withoutInserted(
  raw: string,
  start: number,
  inserted: ReadonlyArray<readonly [number, number]>,
) {
  let out = raw;
  for (let i = inserted.length - 1; i >= 0; i -= 1) {
    const [at, count] = inserted[i];
    const local = at - start;
    if (local >= 0 && local < out.length) out = out.slice(0, local) + out.slice(local + count);
  }
  return out;
}

/**
 * The list `first`, which `call` read from `src`, with every run of lazy lines
 * after a blank line read into it, or `first` itself where there is none.
 */
export function withLazyLines(
  tokenizer: ListTokenizing,
  src: string,
  first: ListToken,
  call: (src: string) => ListToken | undefined,
  endsTheItem: (line: string, indent: number) => boolean,
): ListToken {
  let token = first;
  let indented = src;
  const inserted: Array<[number, number]> = [];
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const last = token.items.at(-1);
    if (last === undefined || !endsInAParagraph(last.tokens)) break;
    const indent = contentColumn(last.raw);
    const run = lazyRun(tokenizer, indented, token.raw.length, indent, endsTheItem);
    if (run.length === 0) break;
    const pad = ' '.repeat(indent);
    let trial = indented;
    for (let i = run.length - 1; i >= 0; i -= 1) {
      trial = `${trial.slice(0, run[i][0])}${pad}${trial.slice(run[i][0])}`;
    }
    const next = call(trial);
    const [lastAt, lastLine] = run[run.length - 1];
    const reach = lastAt + indent * run.length + lastLine.trimEnd().length;
    if (next === undefined || next.raw.length < reach) break;
    // The offsets of the spaces, in the source as indented this round.
    const added = run.map(([at], i): [number, number] => [at + indent * i, indent]);
    for (const [at] of added) {
      for (const entry of inserted) if (entry[0] >= at) entry[0] += indent;
    }
    inserted.push(...added);
    inserted.sort((a, b) => a[0] - b[0]);
    indented = trial;
    token = next;
  }
  if (inserted.length === 0) return first;
  let start = 0;
  for (const item of token.items) {
    const length = item.raw.length;
    item.raw = withoutInserted(item.raw, start, inserted);
    start += length;
  }
  token.raw = withoutInserted(token.raw, 0, inserted);
  return token;
}
