import { marked, type Tokens } from 'marked';
import { describe, expect, it } from 'vitest';
import { createEditor } from './setup';

/**
 * A kept link in every place the review of #587 asked about (#564).
 *
 * Review 5488666922 measured, at `d570a27`, a kept link inside an emphasis
 * with a letter after it written `*[a](irc://x)**b*`, which the second save
 * turned into escaped text, and two inside one emphasis growing on every
 * save. Rows alone had missed it, so this is a sweep: each kind of kept link,
 * crossed with the marks around it and with what touches it on each side,
 * opened and saved twice. Each must hold still from the first save, and open
 * as the document the file was.
 */

/** A kept link of each kind, and another of the same kind with other bytes. */
const KINDS = [
  { name: 'no destination', link: '[a]()', other: '[b]()' },
  { name: 'a scheme off the lists', link: '[a](irc://x)', other: '[b](irc://y)' },
  { name: 'an autolink of such a scheme', link: '<irc://x>', other: '<irc://y>' },
] as const;

/** The marks around it, as an opening and a closing spelling. */
const MARKS = [
  { name: 'none', open: '', close: '' },
  { name: 'emphasis', open: '*', close: '*' },
  { name: 'strong', open: '**', close: '**' },
  { name: 'both', open: '***', close: '***' },
  { name: 'strikethrough', open: '~~', close: '~~' },
  { name: 'superscript', open: '<sup>', close: '</sup>' },
] as const;

/** What touches it on one side: inside the mark, or outside it. */
type Side = { name: string; inside: (link: string, other: string) => string; outside: string };

const SIDES: readonly Side[] = [
  { name: 'nothing', inside: () => '', outside: '' },
  { name: 'a space', inside: () => 'b ', outside: '' },
  { name: 'a letter in the mark', inside: () => 'b', outside: '' },
  { name: 'a letter outside it', inside: () => '', outside: 'b' },
  { name: 'the same link', inside: (link) => link, outside: '' },
  { name: 'another kept link', inside: (_link, other) => other, outside: '' },
  { name: 'a live link', inside: () => '[c](https://z)', outside: '' },
];

/** The text a side writes after the link: the same, mirrored. */
const after = (side: Side, link: string, other: string): string =>
  side.name === 'a space' ? ' b' : side.inside(link, other);

interface Case {
  readonly name: string;
  readonly markdown: string;
}

function cases(): Case[] {
  const all: Case[] = [];
  for (const kind of KINDS) {
    for (const mark of MARKS) {
      for (const left of SIDES) {
        for (const right of SIDES) {
          const inner =
            left.inside(kind.link, kind.other) + kind.link + after(right, kind.link, kind.other);
          all.push({
            name: `${kind.name}, ${mark.name}, ${left.name} before, ${right.name} after`,
            markdown: `${left.outside}${mark.open}${inner}${mark.close}${right.outside}\n`,
          });
        }
      }
    }
  }
  // Bytes holding each dollar pattern a string replacement reads.
  for (const pattern of ['$$', '$&', '$`', "$'"]) {
    for (const mark of MARKS) {
      for (const markdown of [
        `[a${pattern}b](irc://x)`,
        `[a](irc://x?q=${pattern})`,
        `<irc://x?q=${pattern}>`,
      ]) {
        all.push({
          name: `${markdown} in ${mark.name}`,
          markdown: `${mark.open}${markdown}${mark.close}\n`,
        });
      }
    }
  }
  return all;
}

/** Open `markdown` and return what a save writes, and the document it opened as. */
function open(markdown: string): { written: string; document: unknown } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  try {
    editor.setMarkdown(markdown);
    return {
      written: `${editor.getMarkdown()}\n`,
      document: comparable(editor.editor.getJSON() as JsonNode),
    };
  } finally {
    editor.destroy();
    host.remove();
  }
}

/** One character of a block and the marks on it, a kept link read as its destination. */
type Mark = { type: string; attrs?: Record<string, unknown> };
type JsonNode = { type: string; text?: string; marks?: Mark[]; content?: JsonNode[] };

/**
 * The document as a reader has it: each block its characters, each with its
 * marks, a kept link read as its destination and title and told apart from
 * the next by its place, since its bytes and its place are how it is spelled.
 * The marks on a space are left out: an emphasis split at a link edge leaves
 * the space beside it outside, as for a live link.
 */
function comparable(node: JsonNode): unknown {
  if (node.content === undefined) return node.type;
  if (!node.content.some((child) => child.type === 'text')) {
    return { type: node.type, content: node.content.map(comparable) };
  }
  let place = 0;
  let lastAt: unknown = null;
  const characters: string[] = [];
  for (const child of node.content) {
    const marks = (child.marks ?? []).map((mark) => {
      if (mark.type !== 'keptLink') return JSON.stringify(mark);
      if (mark.attrs?.at !== lastAt) place += 1;
      lastAt = mark.attrs?.at;
      const raw = decodeURIComponent(String(mark.attrs?.raw));
      const link = marked.Lexer.lexInline(raw)[0] as Tokens.Link;
      return `kept ${place} ${link.href} ${link.title ?? ''}`;
    });
    if (!marks.some((mark) => mark.startsWith('kept'))) lastAt = null;
    for (const character of child.text ?? `<${child.type}>`) {
      characters.push(
        /\s/.test(character) ? character : `${character} ${marks.sort().join(' | ')}`,
      );
    }
  }
  return { type: node.type, characters };
}

const CASES = cases();

describe('a kept link wherever it stands (#564, review of #587)', () => {
  it(`sweeps ${CASES.length} shapes`, () => {
    // 3 kinds, 6 marks, 7 sides before and 7 after, and 72 dollar shapes.
    expect(CASES).toHaveLength(3 * 6 * 7 * 7 + 4 * 6 * 3);
  });

  it.each(CASES)('$name holds still and opens as it was', ({ markdown }) => {
    const first = open(markdown);
    const second = open(first.written);
    expect(second.written).toBe(first.written);
    expect(second.document).toEqual(first.document);
  });
});
