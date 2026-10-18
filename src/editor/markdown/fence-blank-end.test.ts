import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';

/**
 * #572: a fence ending in blank lines keeps them, CommonMark example 318.
 *
 * On `8ea99e4` `marked` took one line ending off the code before drawing it
 * and turndown took one more when writing it, so such a fence lost a blank
 * line on each save until none was left. Each row is opened, saved, and saved
 * again; GitHub reads each as the original, read with cmark-gfm on #572.
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

function holds(markdown: string, expected: string = markdown): void {
  const once = save(markdown);
  expect(once, 'the first save').toBe(expected);
  expect(save(once), 'the second save').toBe(once);
}

describe('a fence ending in blank lines keeps them', () => {
  it.each([1, 2, 3])('%i blank lines, at the top level, in a quote and in a list item', (count) => {
    holds(`\`\`\`\nx\n${'\n'.repeat(count)}\`\`\`\n`);
    holds(`> \`\`\`\n> x\n${'>\n'.repeat(count)}> \`\`\`\n`);
    holds(`- a\n- \`\`\`\n  x\n${'\n'.repeat(count)}  \`\`\`\n- c\n`);
  });

  it('a tilde fence too', () => {
    holds('~~~\nx\n\n~~~\n');
  });

  it('a fence with none, as before', () => {
    holds('```\nx\n```\n');
    holds('~~~\nx\n~~~\n');
  });
});

describe('an empty fence', () => {
  it('holding two blank lines keeps them', () => {
    holds('```\n\n\n```\n');
  });

  it('holding one is still written as the empty fence, as R-C2 records', () => {
    holds('```\n\n```\n', '```\n```\n');
    holds('```js\n\n```\n', '```js\n```\n');
  });
});
