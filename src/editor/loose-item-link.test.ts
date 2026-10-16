import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * A loose list item whose text is one link keeps it as the file wrote it
 * (#602). See `markdown/loose-item-link.ts` for the route.
 */

let instances: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.innerHTML = '';
});

/** `markdown` inside a quote, its blank lines spelled as a bare marker. */
function inQuote(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/** `markdown` as the content of a list item under `- x`. */
function inItem(markdown: string): string {
  return `- x\n\n${markdown
    .split('\n')
    .map((line) => (line === '' ? '' : `  ${line}`))
    .join('\n')}`;
}

const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['a loose bullet item whose text is one link', '- [a](/x)\n\n- d'],
  ['a loose ordered item whose text is one link', '1. [a](/x)\n\n2. d'],
  ['the link with a title', '- [a](/x "t")\n\n- d'],
  ['a relative link', '- [a](./notes.md)\n\n- d'],
  ['an item holding a nested list a blank line under it (#611)', '- [a](/x)\n\n  - n\n- d'],
  ['a loose task item whose text is one link', '- [ ] [a](/x)\n\n- [ ] d'],
  ['a link carrying the spelling of its destination (#609)', '- [a](</my uri>)\n\n- d'],
  ['an item that is a raw anchor alone, kept as its bytes', '- <a href="/x">a</a>\n\n- d'],
  ['a link with text beside it', '- see [a](/x)\n\n- d'],
  ['a tight item whose text is one link', '- [a](/x)\n- d'],
];

describe('a loose list item whose text is one link (#602)', () => {
  it.each(SHAPES)('%s, at the top level', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });

  it.each(SHAPES)('%s, in a quote', (_label, markdown) => {
    expect(editorWith(inQuote(markdown)).getMarkdown()).toBe(inQuote(markdown));
  });

  it.each(SHAPES)('%s, in a list item', (_label, markdown) => {
    expect(editorWith(inItem(markdown)).getMarkdown()).toBe(inItem(markdown));
  });

  it('a link followed by a space keeps its spelling, the space going as R-C2 records', () => {
    expect(editorWith('- [a](/x) \n\n- d').getMarkdown()).toBe('- [a](/x)\n\n- d');
  });
});

describe('an emphasis around the link of a loose item holds from the first save (#602)', () => {
  // The overlapping-marks exception writes the emphasis inside the brackets;
  // opened again, that link alone took the anchor route on the second save.
  const FIRST: ReadonlyArray<readonly [string, string, string]> = [
    ['at the top level', '- *[a](u)*\n\n- b', '- [*a*](u)\n\n- b'],
    ['in a quote', inQuote('- *[a](u)*\n\n- b'), inQuote('- [*a*](u)\n\n- b')],
    ['in a list item', inItem('- *[a](u)*\n\n- b'), inItem('- [*a*](u)\n\n- b')],
  ];

  it.each(FIRST)('%s', (_label, markdown, written) => {
    const first = editorWith(markdown).getMarkdown();
    expect(first).toBe(written);
    expect(editorWith(first).getMarkdown()).toBe(written);
  });
});
