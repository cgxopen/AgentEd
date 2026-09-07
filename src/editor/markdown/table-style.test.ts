import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import claudeMd from '../../../CLAUDE.md?raw';
import status from '../../../docs/internal/STATUS.md?raw';
import workflow from '../../../docs/internal/WORKFLOW.md?raw';
import readme from '../../../README.md?raw';
import requirements from '../../../REQUIREMENTS.md?raw';
import { markdownToHtml } from './parse';
import {
  decodeTableStyle,
  detectTableStyles,
  TABLE_STYLE_ATTRIBUTE,
  type TableStyle,
  tableStyleAttribute,
} from './table-style';

/**
 * The reading half of #93: what a table's spelling is, taken from the raw
 * markdown before `marked` trims it away.
 *
 * The writing half is pinned at the two levels that matter —
 * `markdown/roundtrip.test.ts` for the pair, `../table-style.test.ts` through
 * a real editor — and this file pins the descriptor itself, including what it
 * refuses.
 */
describe('reading a table s spelling', () => {
  it('reads hugged cells and a spaced three-dash separator', () => {
    const [style] = detectTableStyles('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(style.columns.map((c) => c.kind)).toEqual(['hug', 'hug']);
    expect(style.columns.map((c) => c.separator)).toEqual([' --- ', ' --- ']);
    expect(style.emptyCell).toBeNull();
  });

  it('reads a tight separator whose dashes fill the header cell', () => {
    // README.md's own table, and the reason a single "padded or minimal"
    // boolean cannot describe this repository: the other table in it
    // (WORKFLOW.md) writes the same hugged cells with a spaced three-dash
    // separator instead.
    const [style] = detectTableStyles('| Shortcut | Action |\n|----------|--------|\n| `x` | y |');
    expect(style.columns.map((c) => c.kind)).toEqual(['hug', 'hug']);
    expect(style.columns.map((c) => c.separator)).toEqual(['----------', '--------']);
    expect(style.columns.map((c) => c.width)).toEqual([10, 8]);
  });

  it('reads a hand-aligned column as a fixed width', () => {
    const [style] = detectTableStyles('| a   | bb  |\n| --- | --- |\n| ccc | d   |');
    expect(style.columns.map((c) => c.kind)).toEqual(['fixed', 'fixed']);
    expect(style.columns.map((c) => c.width)).toEqual([5, 5]);
  });

  it('reads a column padded wider than its content needs', () => {
    // The case the issue is about: nothing downstream can recompute this
    // width, because the content does not imply it.
    const [style] = detectTableStyles(
      '| a      | b      |\n| ------ | ------ |\n| c      | d      |',
    );
    expect(style.columns[0]).toEqual({ kind: 'fixed', width: 8, separator: ' ------ ' });
  });

  it('reads the shorter spelling of an empty cell', () => {
    // WORKFLOW.md's header starts with `| |`; hugging an empty cell on its
    // own would give `|  |`, so only the shorter spelling is remembered.
    const [style] = detectTableStyles('| | Does |\n| --- | --- |\n| **Owner** | Decides |');
    expect(style.emptyCell).toBe(' ');
    expect(detectTableStyles('| Step |  |\n| --- | --- |\n|  |  |')[0].emptyCell).toBeNull();
  });

  it('keeps alignment colons in the separator it carries', () => {
    // Alignment is not a feature this issue adds; it falls out of carrying
    // the separator, and this says which way it fell.
    const [style] = detectTableStyles('| a | b |\n| :-- | --: |\n| 1 | 2 |');
    expect(style.columns.map((c) => c.separator)).toEqual([' :-- ', ' --: ']);
  });

  it('finds every table in the document, in order', () => {
    const styles = detectTableStyles(
      '| a | b |\n| --- | --- |\n\ntext\n\n| c   | d   |\n| --- | --- |\n| eee | fff |',
    );
    expect(styles.map((s) => s.columns[0].kind)).toEqual(['hug', 'fixed']);
  });

  it('ignores a table inside a fenced block', () => {
    expect(detectTableStyles('```\n| a | b |\n| --- | --- |\n```')).toEqual([]);
    expect(detectTableStyles('~~~\n| a | b |\n| --- | --- |\n~~~')).toEqual([]);
  });

  it('does not read a pipe in running text as a table', () => {
    expect(detectTableStyles('a | b\nnot a separator')).toEqual([]);
  });

  it('treats an escaped pipe as content, not as a boundary', () => {
    const [style] = detectTableStyles('| a \\| b | c |\n| --- | --- |\n| 1 | 2 |');
    expect(style.columns).toHaveLength(2);
  });
});

describe('reading a style back off a node', () => {
  const style = {
    columns: [{ kind: 'hug' as const, width: 3, separator: ' --- ' }],
    emptyCell: null,
  };

  it('accepts what it wrote', () => {
    expect(decodeTableStyle(JSON.stringify(style))).toEqual(style);
  });

  it('answers null for nothing at all', () => {
    expect(decodeTableStyle(null)).toBeNull();
    expect(decodeTableStyle('')).toBeNull();
  });

  it('refuses a separator that is not dashes, colons and spaces', () => {
    // The one field written into the user's file verbatim. The attribute
    // travels through the document model and the clipboard, so it is
    // validated rather than trusted: anything else and the table falls back
    // to the default spelling.
    // The length bound moved from 200 dashes inside the pattern to 1000
    // characters checked before it: `readStyle` produces a 252-dash separator
    // for a 250-wide aligned column, and the old bound refused it. What the
    // validator is *for* is unchanged — dashes, colons and spaces only.
    for (const separator of ['x', ' --- |', '\n', ' --- <b>', '-'.repeat(1001)]) {
      expect(
        decodeTableStyle(JSON.stringify({ columns: [{ kind: 'hug', width: 3, separator }] })),
      ).toBeNull();
    }
  });

  it('refuses a width that is not a small whole number', () => {
    for (const width of [-1, 1.5, 10_000, '3', Number.NaN]) {
      expect(
        decodeTableStyle(JSON.stringify({ columns: [{ kind: 'hug', width, separator: ' --- ' }] })),
      ).toBeNull();
    }
  });

  it('refuses junk without throwing', () => {
    for (const value of ['{', 'null', '[]', '{"columns":"x"}', '{"columns":[{"kind":"wide"}]}']) {
      expect(decodeTableStyle(value)).toBeNull();
    }
  });
});

describe('the detector and the validator agree — a property, not a case', () => {
  /**
   * **Anything `detectTableStyles` can produce, `decodeTableStyle` must
   * accept.** The two are halves of one module, and before review they
   * disagreed: `readStyle` described a hand-aligned table whose separator was
   * left short — `" ---     "` — perfectly, and the validator's pattern allowed
   * at most one space each side, so it refused the whole style and the table
   * lost its alignment on the first untouched save.
   *
   * A case-by-case test could not have caught that, because the case nobody
   * thought of is the one that broke (#96's lesson: a test exercising the easy
   * case under a comment promising the hard one buys confidence it has not
   * earned). This asserts the relationship instead, over every table shape the
   * fixtures below and this repository's own documents contain — so a future
   * narrowing of either half fails here rather than in someone's file.
   */
  const shapes: Array<[string, string]> = [
    ['hugged, spaced separator', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['hugged, tight separator', '| a | b |\n|---|---|\n| 1 | 2 |'],
    ['tight cells', '|a|b|\n|---|---|\n|1|2|'],
    ['aligned, separator filled', '| Name | Age |\n| ---- | --- |\n| Ada  | 36  |'],
    ['aligned, separator left short', '| Name    | Age |\n| ---     | --- |\n| Ada     | 36  |'],
    [
      'aligned wider than the content needs',
      '| a      | b      |\n| ------ | ------ |\n| 1      | 2      |',
    ],
    ['alignment colons', '| a | b |\n|:--- | ---:|\n| 1 | 2 |'],
    ['centred', '| a | b |\n|:---:|:---:|\n| 1 | 2 |'],
    ['colons, separator left short', '| Name    | Age |\n|:---     |---: |\n| Ada     | 36  |'],
    ['an empty cell written as one space', '| a | b |\n| --- | --- |\n| | 2 |'],
    ['an empty cell written as two', '| a | b |\n| --- | --- |\n|  | 2 |'],
    ['no outer pipes', 'a | b\n--- | ---\n1 | 2'],
    ['one column', '| a |\n| --- |\n| 1 |'],
    ['many columns', `| ${'a | '.repeat(12)}\n| ${'--- | '.repeat(12)}\n| ${'1 | '.repeat(12)}`],
    [
      'a very wide aligned column',
      `| ${'x'.repeat(120)} | b |\n| ---${' '.repeat(118)} | --- |\n| ${'y'.repeat(120)} | 2 |`,
    ],
    ['rows that disagree', '| Name    | Age |\n| ---     | --- |\n| Ada | 36 |'],
    ['a pipe escaped in a cell', '| a \\| b | c |\n| --- | --- |\n| 1 | 2 |'],
    [
      'two tables in one document',
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntext\n\n| c      | d |\n| ------ | --- |\n| 3      | 4 |',
    ],
  ];

  it.each(shapes)('accepts every style read from %s', (_label, markdown) => {
    const styles = detectTableStyles(markdown);
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) {
      expect(decodeTableStyle(JSON.stringify(style))).not.toBeNull();
    }
  });

  // The repository's own documents, as the corpus nobody hand-picked.
  it.each([
    ['README.md', readme],
    ['REQUIREMENTS.md', requirements],
    ['CLAUDE.md', claudeMd],
    ['docs/internal/WORKFLOW.md', workflow],
    ['docs/internal/STATUS.md', status],
  ])('accepts every style read from %s', (_name, source) => {
    const styles = detectTableStyles(source);
    for (const style of styles) {
      expect(decodeTableStyle(JSON.stringify(style))).not.toBeNull();
    }
  });

  it.each([
    ['spaces, at the widest column it will carry', ` ---${' '.repeat(496)}`, 500],
    ['dashes filled to that width', ` ${'-'.repeat(498)} `, 500],
    // The separator row need not line up with the header row, so a separator
    // cell may be longer than the width beside it. Both bounds are exercised
    // at once here: this is the shape that would fail if one were derived
    // from the other.
    ['a separator wider than the column it belongs to', ` ---${' '.repeat(600)}`, 500],
  ])('accepts a separator of %s', (_label, separator, width) => {
    expect(
      decodeTableStyle(
        JSON.stringify({ columns: [{ kind: 'fixed', width, separator }], emptyCell: null }),
      ),
    ).not.toBeNull();
  });

  it('still refuses a separator cell holding anything else', () => {
    // The property widened what is accepted; it did not weaken what the
    // validator is for. This cell is written into the user's file verbatim.
    for (const separator of [
      ' --- x ',
      '<b>',
      ' -- | -- ',
      ' --\n-- ',
      '',
      ` ${'-'.repeat(1200)} `,
    ]) {
      expect(
        decodeTableStyle(
          JSON.stringify({ columns: [{ kind: 'hug', width: 5, separator }], emptyCell: null }),
        ),
      ).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #200 — the style is read from the token, not paired with the document
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `tableStyleAttribute` is handed the `raw` of one table token, so the scan it
 * runs finds one block and the answer belongs to that table alone. What used
 * to happen instead was a pairing by document order that wrote **nothing** for
 * the whole document whenever the two counts disagreed.
 */
describe('tableStyleAttribute reads one table from its own bytes', () => {
  /** The style the attribute carries, decoded back. */
  function styleOf(raw: string): TableStyle | null {
    const attribute = tableStyleAttribute(raw);
    if (attribute === '') return null;
    const value = attribute.slice(attribute.indexOf('="') + 2, -1).replaceAll('&quot;', '"');
    return decodeTableStyle(value);
  }

  it('a padded table gives fixed columns at the file own widths', () => {
    const style = styleOf('| head  | second |\n| ----- | ------ |\n| a     | b      |');
    expect(style?.columns.map((c) => c.kind)).toEqual(['fixed', 'fixed']);
    expect(style?.columns.map((c) => c.width)).toEqual([7, 8]);
  });

  it('a hugged table gives hugged columns', () => {
    expect(styleOf('| a | b |\n| --- | --- |\n| c | d |')?.columns.map((c) => c.kind)).toEqual([
      'hug',
      'hug',
    ]);
  });

  it('the value is escaped so the JSON quotes cannot end the attribute', () => {
    const attribute = tableStyleAttribute('| a | b |\n| --- | --- |\n| c | d |');
    expect(attribute).toContain('&quot;');
    expect(attribute.slice(attribute.indexOf('="') + 2, -1)).not.toContain('"');
  });

  it('a table inside a blockquote reaches the element, which it did not before', () => {
    // The scan this replaces read raw lines and did not look past a quote
    // marker, so `detectTableStyles` finds nothing here while `marked` finds a
    // table — the counts disagreed and every table in the document lost its
    // spelling. `marked` hands the renderer the quote body with the markers
    // already stripped, so the reading is direct. Both halves are asserted,
    // because either alone would pass on a renderer that did nothing.
    const quoted = '> | head  | second |\n> | ----- | ------ |\n> | a     | b      |';
    expect(detectTableStyles(quoted)).toEqual([]);

    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(quoted);
    const table = container.querySelector('blockquote table');
    const style = decodeTableStyle(table?.getAttribute(TABLE_STYLE_ATTRIBUTE) ?? null);
    expect(style?.columns.map((c) => c.kind)).toEqual(['fixed', 'fixed']);
    expect(style?.columns.map((c) => c.width)).toEqual([7, 8]);
  });

  it('anything that is not exactly one table gives no attribute', () => {
    // The refusal is still here and still silent. What changed is its reach:
    // this table falls back to the default spelling, and no other table does.
    expect(tableStyleAttribute('')).toBe('');
    expect(tableStyleAttribute('not a table at all')).toBe('');
    expect(tableStyleAttribute('| a |\n| --- |\n| c |\n\n| x |\n| --- |\n| y |')).toBe('');
  });

  it('every style it produces, the validator accepts', () => {
    // The property from #93, restated on this route: the two halves of the
    // module must agree on what a legal style is, whichever door it came in.
    for (const raw of [
      '| a | b |\n| --- | --- |\n| c | d |',
      '| head  | second |\n| ----- | ------ |\n| a     | b      |',
      '| a | b |\n| :-- | --: |\n| c | d |',
      '| a | b |\n|---|---|\n| c | d |',
      '| a | b |\n| --- | --- |\n| c | |',
    ]) {
      expect(styleOf(raw)).not.toBeNull();
    }
  });
});

describe('the table renderer matches marked byte for byte apart from the attribute', () => {
  /** A `marked` carrying none of this repository configuration. */
  function pristine(markdown: string): string {
    return new Marked({ gfm: true, breaks: false }).parse(markdown, { async: false }) as string;
  }

  const OUR_ATTRIBUTE = new RegExp(` ${TABLE_STYLE_ATTRIBUTE}="[^"]*"`, 'g');

  it.each([
    ['a hugged table', '| a | b |\n| --- | --- |\n| c | d |'],
    ['a padded table', '| head  | second |\n| ----- | ------ |\n| a     | b      |'],
    ['an aligned table', '| a | b |\n| :-- | --: |\n| c | d |'],
    ['a table with no body rows', '| a | b |\n| --- | --- |'],
    ['a table holding inline markup', '| **a** | `b` |\n| --- | --- |\n| [c](https://e.com) | d |'],
    ['a table inside a blockquote', '> | a | b |\n> | --- | --- |\n> | c | d |'],
    ['two tables', '| a |\n| --- |\n| c |\n\n| x |\n| --- |\n| y |'],
  ])('%s renders exactly as the library would', (_label, markdown) => {
    expect(markdownToHtml(markdown).replace(OUR_ATTRIBUTE, '')).toBe(pristine(markdown));
  });

  it('and the attribute is the only difference', () => {
    const markdown = '| a | b |\n| --- | --- |\n| c | d |';
    expect(markdownToHtml(markdown)).not.toBe(pristine(markdown));
    expect(markdownToHtml(markdown)).toContain(`<table ${TABLE_STYLE_ATTRIBUTE}=`);
  });
});

/**
 * The strip that is gone, and what a document can do with the space it left
 * (#200).
 *
 * `attachTableStyles` removed `data-table-style` from every table before
 * writing the detected ones, so a document carrying its own in raw HTML could
 * not reach the serializer. There is no pass any more, so it can — and what it
 * can say is bounded by `decodeTableStyle`, which is what carries the safety
 * the strip used to. Pinned here rather than left to be found.
 */
describe('a table the file wrote as raw HTML carrying the attribute', () => {
  function tableIn(markdown: string): Element | null {
    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(markdown);
    return container.querySelector('table');
  }

  const PADDED_STYLE = JSON.stringify({
    columns: [
      { kind: 'fixed', width: 9, separator: ' ------- ' },
      { kind: 'fixed', width: 9, separator: ' ------- ' },
    ],
    emptyCell: null,
  }).replaceAll('"', '&quot;');

  it('keeps a value the validator accepts', () => {
    const table = tableIn(
      `<table ${TABLE_STYLE_ATTRIBUTE}="${PADDED_STYLE}">\n<tr><td>one</td><td>two</td></tr>\n</table>`,
    );
    const style = decodeTableStyle(table?.getAttribute(TABLE_STYLE_ATTRIBUTE) ?? null);
    expect(style?.columns.map((c) => c.kind)).toEqual(['fixed', 'fixed']);
  });

  it('and a value the validator refuses buys nothing, whatever it holds', () => {
    // The reach of the attribute is what `decodeTableStyle` will accept, and
    // that is the whole of what replaced the strip. A separator cell is dashes,
    // colons and spaces or the style is refused whole.
    const hostile = JSON.stringify({
      columns: [{ kind: 'fixed', width: 9, separator: ' --- <script> ' }],
      emptyCell: null,
    }).replaceAll('"', '&quot;');
    const table = tableIn(
      `<table ${TABLE_STYLE_ATTRIBUTE}="${hostile}">\n<tr><td>one</td></tr>\n</table>`,
    );
    expect(decodeTableStyle(table?.getAttribute(TABLE_STYLE_ATTRIBUTE) ?? null)).toBeNull();
  });

  it('reaches no markdown table, because those are answered from their own bytes', () => {
    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(
      `<table ${TABLE_STYLE_ATTRIBUTE}="${PADDED_STYLE}">\n<tr><td>one</td><td>two</td></tr>\n</table>\n\n| a | b |\n| --- | --- |\n| c | d |`,
    );
    const markdownTable = container.querySelectorAll('table')[1];
    const style = decodeTableStyle(markdownTable?.getAttribute(TABLE_STYLE_ATTRIBUTE) ?? null);
    expect(style?.columns.map((c) => c.kind)).toEqual(['hug', 'hug']);
  });
});
