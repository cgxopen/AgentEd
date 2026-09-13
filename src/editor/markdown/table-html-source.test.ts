import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './parse';
import {
  decodeTableSource,
  isWholeHtmlTable,
  stampTableSource,
  TABLE_HTML_SOURCE_ATTRIBUTE,
} from './table-html-source';

/**
 * The file half of #283: which raw HTML is one whole table, and how its bytes
 * ride on the element. The editor half is in `kept-html-table.test.ts`.
 */

const SIMPLE = '<table><tr><td>a</td></tr></table>';

describe('isWholeHtmlTable', () => {
  it.each([
    ['one line', SIMPLE],
    ['across lines', '<table>\n  <tr><td>a</td></tr>\n</table>'],
    ['with attributes', '<table border="1"><tr><td>a</td></tr></table>'],
    ['in capitals', '<TABLE><TR><TD>a</TD></TR></TABLE>'],
    [
      'indented, with the trailing newline a token carries',
      '  <table><tr><td>a</td></tr></table>\n',
    ],
  ])('accepts a table %s', (_label, raw) => {
    expect(isWholeHtmlTable(raw)).toBe(true);
  });

  it.each([
    ['cut at a blank line', '<table>\n\n'],
    ['with text after it', `${SIMPLE}\nafter`],
    ['inside another element', `<div>${SIMPLE}</div>`],
    ['a tag that only begins with the word', '<tablex><tr><td>a</td></tr></table>'],
    ['a list', '<ul><li>a</li></ul>'],
  ])('refuses %s', (_label, raw) => {
    expect(isWholeHtmlTable(raw)).toBe(false);
  });
});

describe('stampTableSource', () => {
  it('puts the attribute first in the opening tag, and nowhere else', () => {
    const raw = '<table class="x"><tr><td><table><tr><td>in</td></tr></table></td></tr></table>\n';
    const stamped = stampTableSource(raw, raw);
    expect(stamped).toBe(
      `<table ${TABLE_HTML_SOURCE_ATTRIBUTE}="${encodeURIComponent(raw.trimEnd())}" class="x"><tr><td><table><tr><td>in</td></tr></table></td></tr></table>\n`,
    );
  });

  it('stamps nothing on raw HTML that is not one whole table', () => {
    expect(stampTableSource('<div></div>', '<div></div>')).toBeNull();
  });
});

describe('decodeTableSource', () => {
  it('reads back what was stamped', () => {
    expect(decodeTableSource(encodeURIComponent(SIMPLE))).toBe(SIMPLE);
  });

  it.each([
    ['no value', null],
    ['an empty value', ''],
    ['a value that does not decode', '%E0%A4%A'],
    ['a value that is not one whole table', encodeURIComponent('<img src="x">')],
  ])('refuses %s', (_label, value) => {
    expect(decodeTableSource(value)).toBeNull();
  });
});

describe('what the parser hands the editor', () => {
  it('stamps a document-level HTML table with its own bytes', () => {
    expect(markdownToHtml(`${SIMPLE}\n`)).toContain(
      `${TABLE_HTML_SOURCE_ATTRIBUTE}="${encodeURIComponent(SIMPLE)}"`,
    );
  });

  it('keeps the file bytes when the file spells the attribute itself', () => {
    // A parser keeps the first of two attributes with one name, and the stamp
    // goes first.
    const forged = `<table ${TABLE_HTML_SOURCE_ATTRIBUTE}="${encodeURIComponent('<table><tr><td>evil</td></tr></table>')}"><tr><td>a</td></tr></table>`;
    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(forged);
    const value =
      container.querySelector('table')?.getAttribute(TABLE_HTML_SOURCE_ATTRIBUTE) ?? null;
    expect(decodeTableSource(value)).toBe(forged);
  });

  it('stamps nothing on a GFM table', () => {
    expect(markdownToHtml('| a |\n| --- |\n| b |')).not.toContain(TABLE_HTML_SOURCE_ATTRIBUTE);
  });

  it('stamps nothing on a table written inline in a paragraph', () => {
    // An inline `html` token: the tag opens inside running text, which is not
    // a table the file wrote as a block.
    expect(markdownToHtml(`text ${SIMPLE}`)).not.toContain(TABLE_HTML_SOURCE_ATTRIBUTE);
  });
});
