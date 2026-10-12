import { marked, type Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { createEditor } from './setup';

/**
 * Two links side by side with the same destination stay two (#565, owner
 * decision D5 on #565).
 *
 * The editor joined them into one, `[a](/u)[b](/u)` written `[ab](/u)`, and
 * AMP read on #565 that a place counted among the links of one token list
 * would miss a link inside a mark, `*[a](/u)*[b](/u)`. So this is a sweep, as
 * #587 swept the kept link: two links crossed with the marks around each and
 * what stands between them, and a kept link of #564 beside a live one. Each
 * must reopen as the same links with the same text, and hold still from the
 * first save.
 */

const MARKS = [
  { name: 'none', open: '', close: '' },
  { name: 'emphasis', open: '*', close: '*' },
  { name: 'strong', open: '**', close: '**' },
  { name: 'strikethrough', open: '~~', close: '~~' },
  { name: 'superscript', open: '<sup>', close: '</sup>' },
] as const;

/** What stands between the two: nothing, a space, or one mark around both. */
const BETWEEN = ['nothing', 'a space', 'one mark around both'] as const;

/** The second link: the same destination, a kept link, or a live one beside a kept one. */
const PAIRS = [
  { name: 'the same destination', first: '[a](/u)', second: '[b](/u)' },
  { name: 'a kept link after a live one', first: '[a](/u)', second: '[b](irc://u)' },
  { name: 'a live link after a kept one', first: '[a](irc://u)', second: '[b](/u)' },
] as const;

interface Case {
  readonly name: string;
  readonly markdown: string;
}

function cases(): Case[] {
  const all: Case[] = [];
  for (const pair of PAIRS) {
    for (const left of MARKS) {
      for (const right of MARKS) {
        for (const between of BETWEEN) {
          // Two strikethroughs touching spell four tildes, which `marked` reads
          // as text inside the first: that shape moves on every save on
          // `01fdc49` too, with any destinations, so it is no join and is left
          // out here (reported on #565).
          if (
            left.name === 'strikethrough' &&
            right.name === 'strikethrough' &&
            between === 'nothing'
          ) {
            continue;
          }
          const a = `${left.open}${pair.first}${left.close}`;
          const b = `${right.open}${pair.second}${right.close}`;
          const markdown =
            between === 'one mark around both'
              ? `*${a}${b}*`
              : `${a}${between === 'a space' ? ' ' : ''}${b}`;
          all.push({
            name: `${pair.name}, ${left.name} then ${right.name}, ${between} between`,
            markdown: `${markdown}\n`,
          });
        }
      }
    }
  }
  return all;
}

/** The links of the document in reading order: text and destination. */
function links(markdown: string): { written: string; links: string[] } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  try {
    editor.setMarkdown(markdown);
    const found: string[] = [];
    let last: unknown = null;
    editor.editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      const mark = node.marks.find((m) => m.type.name === 'link' || m.type.name === 'keptLink');
      if (mark === undefined) {
        last = null;
        return;
      }
      const key = JSON.stringify(mark.attrs);
      // A kept link is read as its destination: its bytes respell with the marks.
      const destination =
        mark.type.name === 'link'
          ? String(mark.attrs.href)
          : (marked.Lexer.lexInline(decodeURIComponent(String(mark.attrs.raw)))[0] as Tokens.Link)
              .href;
      if (key === last && found.length > 0) {
        found[found.length - 1] = `${found[found.length - 1]}${node.text}`;
      } else {
        found.push(`${destination} ${node.text}`);
      }
      last = key;
    });
    return { written: `${editor.getMarkdown()}\n`, links: found };
  } finally {
    editor.destroy();
    host.remove();
  }
}

const CASES = cases();

describe('two links side by side stay two (#565, D5)', () => {
  it(`sweeps ${CASES.length} shapes`, () => {
    // Less the one shape per pair left out above.
    expect(CASES).toHaveLength(PAIRS.length * (MARKS.length * MARKS.length * BETWEEN.length - 1));
  });

  it.each(CASES)('$name', ({ markdown }) => {
    const opened = links(markdown);
    const reopened = links(opened.written);
    expect(reopened.links).toEqual(opened.links);
    expect(opened.links).toHaveLength(2);
    expect(links(reopened.written).written).toBe(reopened.written);
  });
});
