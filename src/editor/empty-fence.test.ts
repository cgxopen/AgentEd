import { afterEach, describe, expect, it } from 'vitest';
import { applyLineConventions, detectLineConventions } from '../formats/line-conventions';
import { createEditor, type EditorInstance } from './setup';

/**
 * #94 at the level the user meets it: open a document holding a fenced block
 * with nothing in it, change nothing, save — and the block should still be
 * there (R-C2), language and all.
 *
 * **Measured on `cdac091` before anything was written**, because the layer
 * had to be established first: TipTap keeps the empty block through
 * `setMarkdown` and `getMarkdown` — `{"type":"codeBlock","attrs":{"language":"js"},
 * "content":[{"type":"text","text":"\n"}]}` — and the ``` input rule leaves
 * `<pre class="code-block"><code></code></pre>` before anything is typed. So
 * nothing was lost upstream of the serializer: every one of these documents
 * saved as `''` on `main` while the editor still held the block, which is
 * exactly the silence in the issue — the block stays on screen and the file
 * loses it.
 *
 * The pair-level half is in `markdown/empty-fence.test.ts`. This file exists
 * because the blind spot #84 named is real: `roundtrip.test.ts` never builds
 * an editor, and the two cases that decide this issue — the input rule, and a
 * block reopened after being saved — cannot be reached from there at all.
 */
let instance: EditorInstance | null = null;
let reopened: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** A second editor, for the file the first one just wrote. */
function reopen(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  reopened = createEditor(host);
  reopened.setMarkdown(markdown);
  return reopened;
}

/** What the save path writes: the serializer's text, with the file's own line conventions (#79). */
function savedFrom(source: string, editor: EditorInstance): string {
  return applyLineConventions(editor.getMarkdown(), detectLineConventions(source));
}

/**
 * Type into the editor the way a user does, one character at a time through
 * the input rules — which is the only way to reach the ``` rule, and the
 * whole point of the R-C15 case below.
 */
function type(editor: EditorInstance, text: string): void {
  const { view } = editor.editor;
  for (const character of text) {
    const { from, to } = view.state.selection;
    // The same two steps `EditorView` takes for a typed character: offer it to
    // the `handleTextInput` props — which is where the input rules live — and
    // insert it plainly when none of them claims it.
    const insert = () => view.state.tr.insertText(character, from, to);
    const handled = view.someProp('handleTextInput', (rule) =>
      rule(view, from, to, character, insert),
    );
    if (!handled) view.dispatch(insert());
  }
}

afterEach(() => {
  instance?.destroy();
  reopened?.destroy();
  instance = null;
  reopened = null;
  document.body.innerHTML = '';
});

describe('an empty fenced block survives open → save (#94)', () => {
  it.each([
    ['a fence with nothing in it', '```\n```\n'],
    ['a fence with a language', '```js\n```\n'],
    ['a fence between two paragraphs', 'a\n\n```\n```\n\nb\n'],
    ['a fence with a language between two paragraphs', 'a\n\n```js\n```\n\nb\n'],
    ['two empty fences, one with a language', '```\n```\n\n```py\n```\n'],
    ['a fence holding spaces', '```\n   \n```\n'],
    ['an empty fence beside one with content', '```\n```\n\n```js\nconst a = 1;\n```\n'],
  ])('writes %s back byte for byte', (_label, source) => {
    expect(savedFrom(source, editorWith(source))).toBe(source);
  });

  it('keeps a block created with the ``` input rule and saved before anything is typed', () => {
    // R-C15's first moment, and the reason this issue outranks bytes-only
    // work: the plain text box a user makes with ``` and does not fill in.
    const editor = editorWith('');
    type(editor, '``` ');
    expect(editor.editor.getJSON()).toMatchObject({
      content: [{ type: 'codeBlock', attrs: { language: null } }],
    });

    const saved = editor.getMarkdown();
    expect(saved).toBe('```\n```');

    // And still there on reopen — the half a save alone cannot show.
    expect(reopen(saved).editor.getJSON()).toMatchObject({
      content: [{ type: 'codeBlock' }],
    });
    expect(reopened?.getMarkdown()).toBe(saved);
  });

  it('keeps the language of a block created with the ```js input rule', () => {
    const editor = editorWith('');
    type(editor, '```js ');
    expect(editor.editor.getJSON()).toMatchObject({
      content: [{ type: 'codeBlock', attrs: { language: 'js' } }],
    });

    const saved = editor.getMarkdown();
    expect(saved).toBe('```js\n```');
    expect(reopen(saved).editor.getJSON()).toMatchObject({
      content: [{ type: 'codeBlock', attrs: { language: 'js' } }],
    });
  });

  it('keeps a fence around a blank line, and then holds still (#625)', () => {
    // ```⏎⏎``` and ```⏎``` reach the editor as the same block, and the parse
    // tells them apart from the raw of the token; `empty-fence-line.test.ts`
    // holds the shapes.
    const editor = editorWith('```\n\n```\n');
    const saved = savedFrom('```\n\n```\n', editor);
    expect(saved).toBe('```\n\n```\n');
    expect(savedFrom(saved, reopen(saved))).toBe(saved);
  });

  it('leaves a fence that has content alone', () => {
    for (const source of ['```\nx\n```\n', '```js\nconst a = 1;\n\nconst b = 2;\n```\n']) {
      const editor = editorWith(source);
      expect(savedFrom(source, editor)).toBe(source);
      editor.destroy();
    }
  });

  it('leaves an empty paragraph exactly as it was', () => {
    // The narrowness criterion at this level: `blankReplacement` is reached
    // by every blank node, and an empty paragraph is the one a user makes by
    // accident. Passes on `cdac091` too — which is what makes it evidence
    // this change did not move it.
    const editor = editorWith('a\n\nb');
    editor.editor.commands.setTextSelection(2);
    editor.editor.commands.splitBlock();
    expect(editor.editor.getJSON()).toMatchObject({
      content: [{ type: 'paragraph' }, { type: 'paragraph' }, { type: 'paragraph' }],
    });
    expect(editor.getMarkdown()).toBe('a\n\nb');
  });
});
