import { describe, expect, it } from 'vitest';
import { decodeTableStyle, detectTableStyles } from './table-style';

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
    for (const separator of ['x', ' --- |', '\n', ' --- <b>', '-'.repeat(500)]) {
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
