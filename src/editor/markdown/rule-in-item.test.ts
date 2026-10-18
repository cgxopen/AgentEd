import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';

/**
 * #606: a rule that opens an item of a `-` list holds on the second save.
 * On `e194465` `- * * *` was written `- ---`, which is a rule of its own, so
 * the second save dropped the list, CommonMark example 61.
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

describe('a rule opening an item of a dash list is written with stars', () => {
  it.each([
    ['alone', '- * * *\n', '- ***\n'],
    ['under an item', '- a\n\n  - * * *\n', '- a\n\n  - ***\n'],
    ['in a quote', '> - * * *\n', '> - ***\n'],
    ['already written with stars', '- ***\n', '- ***\n'],
  ])('%s', (_name, markdown, expected) => {
    holds(markdown, expected);
  });
});

describe('every other rule is written as before', () => {
  it.each([
    ['in a star list', '* - - -\n', '* ---\n'],
    ['in a plus list', '+ * * *\n', '+ ---\n'],
    ['in an ordered list', '1. * * *\n', '1. ---\n'],
    ['after the text of a dash item', '- a\n\n  * * *\n', '- a\n\n  ---\n'],
    ['at the top level', '* * *\n', '---\n'],
  ])('%s', (_name, markdown, expected) => {
    holds(markdown, expected);
  });
});
