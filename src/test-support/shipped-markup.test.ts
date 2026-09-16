/**
 * Rows for `shippedElement`, written from the defect that produced it: a slice
 * that ended at the first closing tag mounted half an element once something
 * was nested inside it, and ten rows two files away failed on a null element
 * rather than on what they were about (#332).
 */
import { describe, expect, it } from 'vitest';
import { shippedElement } from './shipped-markup';

describe('shippedElement', () => {
  it('takes the whole element when nothing of the same kind is inside it', () => {
    const page = '<body><div id="a"><span>one</span></div><div id="b">two</div></body>';
    expect(shippedElement(page, '<div id="a">')).toBe('<div id="a"><span>one</span></div>');
  });

  it('takes the whole element when one of the same kind is nested inside it', () => {
    // The case the old slice failed: its end was the inner close tag.
    const page = '<div id="a">one<div id="inner">two</div>three</div><div id="b">four</div>';
    expect(shippedElement(page, '<div id="a">')).toBe(
      '<div id="a">one<div id="inner">two</div>three</div>',
    );
  });

  it('counts through more than one level', () => {
    const page = '<div id="a"><div><div>deep</div></div>tail</div>after';
    expect(shippedElement(page, '<div id="a">')).toBe(
      '<div id="a"><div><div>deep</div></div>tail</div>',
    );
  });

  it('does not let a self-closing tag of the same name raise the depth', () => {
    const page = '<div id="a"><div/>one</div>after';
    expect(shippedElement(page, '<div id="a">')).toBe('<div id="a"><div/>one</div>');
  });

  it('matches an opening tag by its name and not by the string given', () => {
    // The callers pass a prefix — `<details id="frontmatter-panel"` — since the
    // attributes after it are not theirs to restate.
    const page = '<details id="p" open><div>x</div></details>tail';
    expect(shippedElement(page, '<details id="p"')).toBe(
      '<details id="p" open><div>x</div></details>',
    );
  });

  it('throws rather than returning a short string it cannot balance', () => {
    expect(() => shippedElement('<div id="a">one', '<div id="a">')).toThrow(/never closed/);
    expect(() => shippedElement('<div id="b"></div>', '<div id="a">')).toThrow(/no longer has/);
  });

  it('takes the real row out of the shipped page, badges and all', () => {
    // The end of the defect, said against the file rather than against a
    // fixture: the row holds a framed readout now, and the badges come after it.
    const row = shippedElement(
      `<div id="header-indicators">
         <div id="count-readout"><span id="token-number">-</span></div>
         <span id="badge-metadata"></span>
       </div>tail`,
      '<div id="header-indicators">',
    );
    expect(row).toContain('badge-metadata');
    expect(row.endsWith('</div>')).toBe(true);
  });
});
