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

// Since #744 a rule keeps the spelling its file gave it, so a file spelled
// `- * * *` holds as it was. The trap of #606 is met by a rule written `---`,
// the spelling written unasked, pinned below with a rule the editor makes, and
// by a carried spelling of the marker character, which only an edit can put
// there, pinned in `strike-rule-spelling.test.ts`.
describe('a rule opening an item of a dash list holds on the second save', () => {
  it.each([
    ['alone', '- * * *\n', '- * * *\n'],
    ['under an item', '- a\n\n  - * * *\n', '- a\n\n  - * * *\n'],
    ['in a quote', '> - * * *\n', '> - * * *\n'],
    ['already written with stars', '- ***\n', '- ***\n'],
  ])('%s', (_name, markdown, expected) => {
    holds(markdown, expected);
  });

  it('a rule the editor makes there is written with stars', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    instance = createEditor(host);
    instance.setMarkdown('- a\n');
    // The caret at the start of the item text: the rule goes in before it.
    instance.editor.chain().setTextSelection(3).setHorizontalRule().run();
    const written = `${instance.getMarkdown().trim()}\n`;
    expect(written).toMatch(/^- \*\*\*\n/);
    expect(save(written)).toBe(written);
  });
});

describe('every other rule keeps the spelling of its file (#744)', () => {
  it.each([
    ['in a star list', '* - - -\n', '* - - -\n'],
    ['in a plus list', '+ * * *\n', '+ * * *\n'],
    ['in an ordered list', '1. * * *\n', '1. * * *\n'],
    ['after the text of a dash item', '- a\n\n  * * *\n', '- a\n\n  * * *\n'],
    ['at the top level', '* * *\n', '* * *\n'],
  ])('%s', (_name, markdown, expected) => {
    holds(markdown, expected);
  });
});
