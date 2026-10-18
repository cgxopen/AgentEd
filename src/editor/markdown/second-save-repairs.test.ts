import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';

/**
 * #572, head 2: the shapes the first save wrote so that the second wrote them
 * otherwise. Each row is opened, saved, and saved again: the second save must
 * write what the first did. GitHub reads each first save as the original,
 * read with cmark-gfm on the pull request.
 */

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

function save(markdown: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance?.destroy();
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return `${instance.getMarkdown().trim()}\n`;
}

function holds(markdown: string, expected: string): void {
  const once = save(markdown);
  expect(once, 'the first save').toBe(expected);
  expect(save(once), 'the second save').toBe(once);
}

describe('breaks in a raw HTML block drawn as a paragraph', () => {
  // Real blocks of the corpus snapshot, which moved on the second save on head 1
  // at the top level; in a list item and a quote they held already.
  it.each([
    [
      'a centred div ending in a break, the parse5 header',
      '<div align="center">\n<h1>parse5</h1>\n<i><b>HTML parser and serializer.</b></i>\n</div>\n<br>\n\nNext.\n',
      '# parse5\n\n***HTML parser and serializer.***\n\nNext.\n',
    ],
    [
      'an image and a break, top level',
      '<img src="media/logo.svg" width="400">\n<br>\n\nNext.\n',
      '<img src="media/logo.svg" width="400">\n\nNext.\n',
    ],
    [
      'a linked image spelled on lines of its own',
      '<a href="https://github.com/styled-components/polished">\n  <img alt="polished" src="https://raw.githubusercontent.com/styled-components/brand/master/polished.png" height="150px" />\n</a>\n<br />\n\nNext.\n',
      '[<img alt="polished" src="https://raw.githubusercontent.com/styled-components/brand/master/polished.png" height="150px" />](https://github.com/styled-components/polished)\n\nNext.\n',
    ],
    [
      'an image and a break in a list item',
      '- <img src="media/logo.svg" width="400">\n  <br>\n\n- Next.\n',
      '- <img src="media/logo.svg" width="400">\n\n- Next.\n',
    ],
    [
      'an image and a break in a quote',
      '> <img src="media/logo.svg" width="400">\n> <br>\n',
      '> <img src="media/logo.svg" width="400">\n',
    ],
    [
      'a linked image in a list item',
      '- <a href="https://github.com/styled-components/polished">\n    <img alt="polished" src="https://raw.githubusercontent.com/styled-components/brand/master/polished.png" height="150px" />\n  </a>\n  <br />\n\n- Next.\n',
      '- [<img alt="polished" src="https://raw.githubusercontent.com/styled-components/brand/master/polished.png" height="150px" />](https://github.com/styled-components/polished)\n\n- Next.\n',
    ],
    [
      'a linked image in a quote',
      '> <a href="https://github.com/styled-components/polished">\n>   <img alt="polished" src="https://raw.githubusercontent.com/styled-components/brand/master/polished.png" height="150px" />\n> </a>\n> <br />\n',
      '> [<img alt="polished" src="https://raw.githubusercontent.com/styled-components/brand/master/polished.png" height="150px" />](https://github.com/styled-components/polished)\n',
    ],
  ])('%s', (_name, markdown, expected) => {
    holds(markdown, expected);
  });
});

describe('a strikethrough over a link and the text beside it', () => {
  it.each([
    [
      'a struck heading with a reference link and a date',
      '## ~~[v0.15.0] - 2024-10-01~~\n\n[v0.15.0]: https://e.com/v\n',
      '## ~~[v0.15.0] - 2024-10-01~~\n\n[v0.15.0]: https://e.com/v\n',
    ],
    ['in a list item', '- ~~[a](/u) - text~~\n', '- ~~[a](/u) - text~~\n'],
    ['in a quote', '> ~~[a](/u) - text~~\n', '> ~~[a](/u) - text~~\n'],
    ['two struck links touching', '~~[a](/u)~~~~[b](/u)~~\n', '~~[a](/u)\\~~~~[b](/u)~~\n'],
    ['a struck link alone keeps its nesting', '~~[a](/u)~~ and text\n', '[~~a~~](/u) and text\n'],
  ])('%s', (_name, markdown, expected) => {
    holds(markdown, expected);
  });
});

describe('an emphasis touching a strong one', () => {
  it.each([
    ['at the top level', '<b>`a`</b><i>v</i><b>`b`</b> x\n', '**`a`**_v_**`b`** x\n'],
    ['in a list item', '- <b>`a`</b><i>v</i><b>`b`</b>\n', '- **`a`**_v_**`b`**\n'],
    [
      'in a quote, where today it reads back right and is left alone',
      '> <b>a</b><i>v</i><b>b</b>\n',
      '> **a***v***b**\n',
    ],
  ])('%s', (_name, markdown, expected) => {
    holds(markdown, expected);
  });
});

describe('an emphasis over a sup beside a digit', () => {
  it.each([
    [
      'at the top level',
      'multiplied by 2<sup>*Δ*</sup>; ok\n',
      'multiplied by 2<sup>*Δ*</sup>; ok\n',
    ],
    ['in a list item', '- by 2<sup>*Δ*</sup>; ok\n', '- by 2<sup>*Δ*</sup>; ok\n'],
    ['in a quote', '> by 2<sup>**Δ**</sup>x\n', '> by 2<sup>**Δ**</sup>x\n'],
    [
      'an emphasis around a sup with space beside it is left alone',
      'a *<sup>x</sup>* b\n',
      'a *<sup>x</sup>* b\n',
    ],
  ])('%s', (_name, markdown, expected) => {
    holds(markdown, expected);
  });
});
