import { describe, expect, it } from 'vitest';
import { LINK_START } from './link-start';
import { heldApartFromItsText } from './link-text-link';
import './parse';

/** The bytes of a link written `[content](u)`, passed through the rule. */
const held = (content: string): string => heldApartFromItsText(`[${content}](u)`, content);

describe('a link whose text shows a link is written as one link (#762)', () => {
  it('escapes the parenthesis that opens the inner destination', () => {
    expect(held('a \\[b\\](c)')).toBe('[a \\[b\\]\\(c)](u)');
  });

  it('escapes each of them, and only the opening one', () => {
    expect(held('\\[a\\](b) and \\[c\\](d "t")')).toBe('[\\[a\\]\\(b) and \\[c\\]\\(d "t")](u)');
  });

  it('leaves the bytes of a code span, which hold no escape', () => {
    expect(held('a `\\](c)` \\[b\\](c)')).toBe('[a `\\](c)` \\[b\\]\\(c)](u)');
  });

  it('leaves a link with no escaped bracket untouched', () => {
    expect(held('a (b) c')).toBe('[a (b) c](u)');
  });

  it('leaves escaped brackets with no destination after them untouched', () => {
    expect(held('\\[b\\] x')).toBe('[\\[b\\] x](u)');
  });

  it('leaves a real image inside the link untouched', () => {
    expect(held('![i](i.png) x')).toBe('[![i](i.png) x](u)');
  });

  it('keeps the mark of a link start in front', () => {
    const content = 'a \\[b\\](c)';
    expect(heldApartFromItsText(`${LINK_START}[${content}](u)`, content)).toBe(
      `${LINK_START}[a \\[b\\]\\(c)](u)`,
    );
  });
});
