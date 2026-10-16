/**
 * The list-spacing renderer (#28, moved to this route by #200).
 *
 * Two halves, and neither asserts anything alone. The **attribute** half pins
 * what `listSpacingAttribute` says about a set of items; the **drift** half
 * pins that the tag around it is still `marked`'s own, byte for byte, so a
 * release that changes the shape of a list fails here rather than in somebody
 * document.
 *
 * The editor-level behaviour — what the file gets back — is next door in
 * `../loose-lists.test.ts` and in the round-trip table. This file is about the
 * one function and the one renderer.
 */
import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { ADJACENT_ATTRIBUTE } from './adjacency';
import { LIST_SPACING_ATTRIBUTE, listSpacingAttribute } from './list-spacing';
import { markdownToHtml } from './parse';
import { TABLE_STYLE_ATTRIBUTE } from './table-style';

const LOOSE = ` ${LIST_SPACING_ATTRIBUTE}="true"`;

describe('listSpacingAttribute reads the file own spacing, not CommonMark question', () => {
  it('an item ending in a blank line makes the list loose', () => {
    expect(listSpacingAttribute([{ raw: '- a\n\n' }, { raw: '- b' }])).toBe(LOOSE);
  });

  it('no blank line between the items makes it tight', () => {
    expect(listSpacingAttribute([{ raw: '- a\n' }, { raw: '- b' }])).toBe('');
  });

  it('a blank line after the last item says nothing — it separates the list', () => {
    // That blank line belongs to whatever follows the list, which is why the
    // last item is excluded from the reading.
    expect(listSpacingAttribute([{ raw: '- a\n' }, { raw: '- b\n\n' }])).toBe('');
  });

  it('an item holding two blocks does not make a tight list loose', () => {
    // CommonMark calls this list loose and `marked` wraps both bodies in
    // `<p>`; the file is spelled tight between its items and the file decides.
    expect(listSpacingAttribute([{ raw: '- one\n\n  second para\n' }, { raw: '- two' }])).toBe('');
  });

  it('a single-item list is tight, whatever it ends with', () => {
    expect(listSpacingAttribute([{ raw: '- a\n\n' }])).toBe('');
  });

  it('an empty list is tight', () => {
    expect(listSpacingAttribute([])).toBe('');
  });

  it('an item with no raw at all is read as no blank line rather than throwing', () => {
    expect(listSpacingAttribute([{}, {}])).toBe('');
  });
});

describe('the attribute lands on the list it was read from', () => {
  /** Whether each `<ul>`/`<ol>` carries the attribute, in document order. */
  function spacing(markdown: string): boolean[] {
    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(markdown);
    return Array.from(container.querySelectorAll('ul, ol')).map((list) =>
      list.hasAttribute(LIST_SPACING_ATTRIBUTE),
    );
  }

  it.each([
    ['a tight list', '- a\n- b', [false]],
    ['a loose list', '- a\n\n- b', [true]],
    ['a tight list nested in a loose one', '- a\n\n  - x\n  - y\n\n- b', [true, false]],
    ['a loose list nested in a tight one', '- a\n  - x\n\n  - y\n- b', [false, true]],
    // Every list in this one is loose, and it is here for a reason the other
    // nested rows cannot serve: they all hold a tight list, so a change that
    // wrote the attribute on **every** list would redden them and this row
    // would stay green. Without it, no row separates *reads the spacing* from
    // *reaches a nested list at all*.
    ['a loose list nested in a loose one', '- a\n\n  - x\n\n  - y\n\n- b', [true, true]],
    [
      'three levels of nesting',
      '- a\n\n  - x\n\n    - deep\n    - deeper\n\n  - y\n\n- b',
      [true, true, false],
    ],
    ['a loose list inside a blockquote', '> - a\n>\n> - b', [true]],
    [
      'a list inside a blockquote inside a list item',
      '- a\n\n  > - x\n  > - y\n\n- b',
      [true, false],
    ],
    ['a loose ordered list', '1. a\n\n2. b', [true]],
    ['two lists of different kinds', '- a\n- b\n\n1. c\n\n2. d', [false, true]],
  ])('%s', (_label, markdown, expected) => {
    expect(spacing(markdown)).toEqual(expected);
  });

  // ── The case the pairing could not do, and the reason this route exists ──

  it('a list the file wrote as raw HTML gets no attribute, and costs the others nothing', () => {
    // The pairing wrote nothing at all here, because the walk could not see a
    // list that arrives as an `html` token while the selector could. Now the
    // markdown list is answered from its own bytes and the raw one is simply
    // not asked (#200).
    expect(spacing('- a\n\n- b\n\n<ul>\n<li>one</li>\n</ul>')).toEqual([true, false]);
  });

  it('the same holds for a list inside a details block', () => {
    const md =
      '- a\n\n- b\n\n<details>\n<summary>more</summary>\n<ul>\n<li>one</li>\n</ul>\n</details>';
    expect(spacing(md)).toEqual([true, false]);
  });
});

describe('the list renderer matches marked byte for byte apart from the attribute', () => {
  /**
   * A `marked` with none of this repository configuration on it, built here
   * rather than imported so it cannot pick up an override by accident — the
   * same guard `image-alt.test.ts` puts on the image renderer.
   */
  function pristine(markdown: string): string {
    return new Marked({ gfm: true, breaks: false }).parse(markdown, { async: false }) as string;
  }

  /**
   * The attributes this repository writes onto a block element, removed
   * together: one row below holds a table inside a list item, and the table
   * one is pinned by the guard in `table-style.test.ts` rather than here; the
   * count of blank lines above a block in an item (#601) by `item-spacing.test.ts`.
   */
  const OUR_ATTRIBUTES = new RegExp(
    ` ${LIST_SPACING_ATTRIBUTE}="true"| ${TABLE_STYLE_ATTRIBUTE}="[^"]*"| ${ADJACENT_ATTRIBUTE}="\\d+"`,
    'g',
  );

  it.each([
    ['a tight list', '- a\n- b'],
    ['a loose list', '- a\n\n- b'],
    ['a nested list', '- a\n\n  - x\n  - y\n\n- b'],
    ['an ordered list', '1. a\n2. b'],
    ['an ordered list that names its start', '3. a\n4. b'],
    ['a list inside a blockquote', '> - a\n> - b'],
    ['an item holding two blocks', '- one\n\n  second para\n- two'],
    ['a list holding a fenced block', '- a\n\n  ```\n  x\n  ```\n\n- b'],
    ['a list holding a table', '- a\n\n  | h |\n  | --- |\n  | c |\n\n- b'],
  ])('%s renders exactly as the library would', (_label, markdown) => {
    // The attribute is this repository addition and nothing else may be. A
    // task list is deliberately absent: `rewriteCheckboxes` and `markTaskLists`
    // rewrite that shape on purpose (#160, #110), and their own tests pin it.
    expect(markdownToHtml(markdown).replace(OUR_ATTRIBUTES, '')).toBe(pristine(markdown));
  });

  it('and the attribute is the only difference where the list is loose', () => {
    // The other side of the same claim, so the pair cannot both be satisfied
    // by a renderer that writes nothing at all.
    const markdown = '- a\n\n- b';
    expect(markdownToHtml(markdown)).not.toBe(pristine(markdown));
    expect(markdownToHtml(markdown)).toContain(`<ul${LOOSE}>`);
  });
});

/**
 * The strip that is gone, and what a document can do with the space it left
 * (#200).
 *
 * The pass this replaces removed `data-loose` from every list before writing
 * the detected values, so a document carrying its own in raw HTML could not
 * reach the serializer. There is no pass any more, so it can. The attribute is
 * pinned here rather than left to be found: a list the file wrote as HTML says
 * how **that list** is written back, and there is no fallback by which it
 * reaches another one.
 */
describe('a list the file wrote as raw HTML carrying the attribute (#447)', () => {
  // Until #447 the attribute was kept, so a raw HTML list chose how it was
  // written back. The pipeline stamps it for itself, and a document no longer
  // supplies it: the list is written the way any raw HTML list is.
  it('does not keep it', () => {
    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(
      `<ul ${LIST_SPACING_ATTRIBUTE}="true">\n<li>one</li>\n<li>two</li>\n</ul>`,
    );
    expect(container.querySelector('ul')?.hasAttribute(LIST_SPACING_ATTRIBUTE)).toBe(false);
  });

  it('and a markdown list beside it is still answered from its own bytes', () => {
    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(
      `<ul ${LIST_SPACING_ATTRIBUTE}="true">\n<li>one</li>\n</ul>\n\n- a\n\n- b`,
    );
    const lists = Array.from(container.querySelectorAll('ul'));
    expect(lists.map((l) => l.hasAttribute(LIST_SPACING_ATTRIBUTE))).toEqual([false, true]);
  });
});
