import { describe, expect, it } from 'vitest';
import { findOpenCut, mayHoldOpenCut, openCutIn } from './open-cut';

/**
 * The filter decides only whether to lex, and must never skip a file the
 * detector would refuse (owner decision of 2026-10-01 on #455). An HTML block
 * may begin after the markers of a blockquote or a list item and after their
 * indentation, so the sweep below puts each kind of cut behind each container
 * this editor writes, nested ones included, and asks both questions of every
 * one.
 */
const CONTAINERS: ReadonlyArray<readonly [string, (line: string) => string]> = [
  ['the top level', (line) => line],
  ['a top level indented by three spaces', (line) => `   ${line}`],
  ['a blockquote', (line) => `> ${line}`],
  ['a blockquote with no space after the marker', (line) => `>${line}`],
  ['a nested blockquote', (line) => `> > ${line}`],
  ['a bullet item', (line) => `- ${line}`],
  ['an item with an asterisk', (line) => `* ${line}`],
  ['an ordered item', (line) => `1. ${line}`],
  ['an ordered item with a parenthesis', (line) => `12) ${line}`],
  ['a task item', (line) => `- [ ] ${line}`],
  ['a quote inside an item', (line) => `- > ${line}`],
  ['an item inside a quote', (line) => `> - ${line}`],
  ['a nested item', (line) => `- a\n  - ${line}`],
  ['a second paragraph of an item', (line) => `- a\n\n  ${line}`],
  ['a tab-indented item body', (line) => `-\ta\n\n\t${line}`],
];

const OPENERS: ReadonlyArray<readonly [string, string]> = [
  ['an attribute value', '<p title="one'],
  ['an attribute value in single quotes', "<div class='one"],
  ['a comment', '<!-- never closed'],
  // The raw-text elements of #458, one of each kind of block they begin.
  ['a style left open', '<style>'],
  ['a title left open', '<title>'],
];

const SWEEP = CONTAINERS.flatMap(([where, wrap]) =>
  OPENERS.map(([kind, opener]) => [
    `${kind} in ${where}`,
    `Intro.\n\n${wrap(opener)}\n\nAfter.\n\nMore.\n`,
  ]),
);

describe('the filter never skips a file the detector refuses (#455)', () => {
  // Asked of the detector with no filter in front of it: through the filter,
  // a filter that skipped a file would make the detector answer null and the
  // row would assert nothing.
  it.each(SWEEP)('%s', (_label, file) => {
    if (openCutIn(file) !== null) expect(mayHoldOpenCut(file), file).toBe(true);
  });

  it('refuses all of the sweep but two, so the rows above assert something', () => {
    // The two: an unclosed comment at the top level runs to the end of the
    // document, so it has nothing after it to take.
    const opened = SWEEP.filter(([, file]) => openCutIn(file) === null).map(([label]) => label);
    expect(opened).toEqual([
      'a comment in the top level',
      'a comment in a top level indented by three spaces',
    ]);
  });

  it('refuses at least the shapes the issue names, so the sweep is not vacuous', () => {
    for (const [where, wrap] of CONTAINERS.slice(0, 6)) {
      expect(findOpenCut(`Intro.\n\n${wrap('<p title="one')}\n\nAfter.\n`), where).not.toBeNull();
    }
    expect(findOpenCut('> <!-- never closed\n\nAfter.\n')).not.toBeNull();
  });

  it('lets a document with no tag opening a line through without a lex', () => {
    expect(mayHoldOpenCut('# Title\n\nWords with <b>inline</b> html.\n')).toBe(false);
    expect(mayHoldOpenCut('a < b and c > d\n')).toBe(false);
  });
});

describe('what the detector reports (#455)', () => {
  it('names the line where the cut begins and its kind', () => {
    expect(findOpenCut('A.\n\nB.\n\n<p title="x\n\ny">z</p>\n\nC.\n')).toEqual({
      line: 5,
      kind: 'attribute',
    });
    expect(findOpenCut('> <!-- open\n\nC.\n')).toEqual({ line: 1, kind: 'comment' });
  });

  it('reports nothing for a block that is the last thing in the document', () => {
    expect(findOpenCut('A.\n\n<p title="x\n\n')).toBeNull();
    expect(findOpenCut('A.\n\n<!-- open\n\nB.\n')).toBeNull();
  });
});
