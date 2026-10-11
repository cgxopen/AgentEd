/**
 * #563 review: the scans of `kept-raw-html.ts` were made linear in the length
 * of the token, and they must give the answers the first ones gave. Below, the
 * first versions, kept here as they were on `a7a164c` for this comparison
 * alone, asked of every raw HTML token of the 652 CommonMark examples, as a
 * whole block and inline, and of every HTML block they render. No timing is
 * asserted: the times are in the pull request of #563.
 */
import specText from 'commonmark-spec/spec.txt?raw';
import { marked, type Token } from 'marked';
import { describe, expect, it } from 'vitest';
import {
  type AnchorsOpen,
  DRAWS,
  HELD,
  keepInsideBlock,
  keptPiece,
  keptRawHtmlCarrier,
  PIECE,
} from './kept-raw-html';
import { holdsFilteredTag } from './tag-filter';

/** `keptPiece` as it was on `a7a164c`: the rest rebuilt with one replacement per piece. */
function firstKeptPiece(text: string, before: AnchorsOpen, wholeBlock: boolean) {
  const refusedTags = wholeBlock ? DRAWS : HELD;
  let { kept, links } = before;
  const refused = { kept: false, after: before };
  if (holdsFilteredTag(text)) return refused;
  let rest = text;
  let pieces = 0;
  for (const match of text.matchAll(PIECE)) {
    pieces++;
    rest = rest.replace(match[0], '');
    const name = match[2]?.toLowerCase();
    if (name === undefined) continue;
    if (name === 'a') {
      if (match[1] === '') {
        if (/(?:^|\s)href\s*=/i.test(match[3] ?? '')) return refused;
        kept++;
      } else if (kept > 0) {
        kept--;
      } else if (links > 0) {
        return refused;
      }
      continue;
    }
    if (refusedTags.has(name)) return refused;
  }
  if (pieces === 0 || rest.trim() !== '') return refused;
  return { kept: true, after: { kept, links } };
}

/** `keepInsideBlock` as it was on `a7a164c`: a slice of the block scanned per construct. */
function firstKeepInsideBlock(html: string): string {
  const visible = (part: string) => part.replace(PIECE, '').trim() !== '';
  return html.replace(PIECE, (piece, _close, name: string | undefined, _a, at: number) => {
    if (name !== undefined) {
      const tag = name.toLowerCase();
      return tag === 'a' || HELD.has(tag) || holdsFilteredTag(piece)
        ? piece
        : keptRawHtmlCarrier(piece, false);
    }
    const before = visible(html.slice(0, at));
    const after = visible(html.slice(at + piece.length));
    return !before && after ? piece : keptRawHtmlCarrier(piece, false);
  });
}

function rawHtmlOfTheSpec(): string[] {
  const tests = specText.replace(/\r\n?/g, '\n').split(/^<!-- END TESTS -->/m)[0];
  const fence = '`'.repeat(32);
  const pattern = new RegExp(`^${fence} example\\n([\\s\\S]*?)^\\.\\n[\\s\\S]*?^${fence}$`, 'gm');
  const raws: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === 'html') raws.push(token.raw);
      const node = token as unknown as Record<string, unknown>;
      for (const key of ['tokens', 'items'])
        if (Array.isArray(node[key])) walk(node[key] as Token[]);
    }
  };
  for (const match of tests.matchAll(pattern)) walk(marked.lexer(match[1].replace(/→/g, '\t')));
  return raws;
}

describe('the linear scans answer as the first ones did (#563 review)', () => {
  const raws = rawHtmlOfTheSpec();
  const states: AnchorsOpen[] = [
    { kept: 0, links: 0 },
    { kept: 1, links: 0 },
    { kept: 0, links: 1 },
  ];

  it('reads every raw HTML token of the spec, 89 of them', () => {
    expect(raws.length).toBe(89);
  });

  it('keptPiece, as a block and inline, from each anchor state', () => {
    for (const raw of raws) {
      for (const state of states) {
        for (const wholeBlock of [true, false]) {
          expect(keptPiece(raw, state, wholeBlock), raw).toEqual(
            firstKeptPiece(raw, state, wholeBlock),
          );
        }
      }
    }
  });

  it('keepInsideBlock', () => {
    for (const raw of raws) expect(keepInsideBlock(raw), raw).toBe(firstKeepInsideBlock(raw));
  });
});
