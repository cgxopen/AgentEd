import { describe, expect, it } from 'vitest';
import { htmlBlockEnd } from './html-block-end';

describe('where the HTML tokenizer stands at the end of a block (#455, #457 review)', () => {
  it.each([
    ['a value left open by a blank line', '<div title="a\n\n', 'quote'],
    ['a value in single quotes left open', "<div title='a\n\n", 'quote'],
    ['a closed element', '<p title="a">x</p>\n\n', 'data'],
    ['an apostrophe in an unquoted value', "<p title=don't>hello</p>\n\n", 'data'],
    ['a quote inside an unquoted value', '<p class=a"b>hello</p>\n\n', 'data'],
    ['a quote inside an attribute name', '<p a"b="c">x</p>\n\n', 'data'],
    ['a value after spaces round the equals sign', '<p title = "a\n\n', 'quote'],
    [
      'quotes in the text of a script',
      '<script>\nif (a<b) s = "x";\n// don\'t\n</script>\n\n',
      'data',
    ],
    ['quotes in a style', '<style>\na::after { content: "x }\n</style>\n\n', 'data'],
    ['the end tag in capitals', '<SCRIPT>"x</Script>\n\n', 'data'],
    ['a script never closed', '<script>\nx = "\n\n', 'raw-text'],
    ['plaintext, which never ends', '<plaintext>"a\n</plaintext>\n\n', 'raw-text'],
    ['a comment holding a quote', '<!-- "x -->\n\n', 'data'],
    ['a comment left open', '<!-- x\n\n', 'comment'],
    ['an empty comment', '<!-->\n\n', 'data'],
    ['a tag left open with an attribute', '<div class="x"\n\n', 'tag'],
    ['an end tag holding a quote', '</p title="x">\n\n', 'data'],
  ])('%s', (_label, raw, state) => {
    expect(htmlBlockEnd(raw).state).toBe(state);
  });

  it('says which raw-text element the block ends in, and where it began (#458)', () => {
    expect(htmlBlockEnd('<div>\n<style>\np {}\n\n').rawText).toEqual({
      element: 'style',
      start: 6,
      text: '\np {}\n\n',
    });
    expect(htmlBlockEnd('<style>p {}</style>\n\n').rawText).toBeUndefined();
  });

  it('notices words inside a tag after a blank line, and only there', () => {
    expect(htmlBlockEnd('<div\n\nsome text\n\n').wordsAfterBlankLineInTag).toBe(true);
    expect(htmlBlockEnd('<div class="x"\n\n').wordsAfterBlankLineInTag).toBe(false);
    expect(htmlBlockEnd('<div\nclass="x">\n\n').wordsAfterBlankLineInTag).toBe(false);
    expect(htmlBlockEnd('<div>\n\nsome text\n\n').wordsAfterBlankLineInTag).toBe(false);
  });
});
