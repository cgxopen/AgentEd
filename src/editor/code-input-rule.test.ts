import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

/**
 * #619: a typed code span keeps the character typed before it.
 *
 * The shipped rule deleted it: `` ax`code` `` came out as `a` and the span,
 * `` (`code`) `` as the span and `)`. Each row types through
 * `handleTextInput`, the route a keypress takes, so the input rules run, and
 * reads both the document and what a save writes.
 */

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

function emptyEditor(): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown('');
  instance.editor.commands.focus('end');
  return instance;
}

/** Feed text the way a keypress does, so the markdown input rules run. */
function typeText(editor: EditorInstance, text: string): void {
  for (const character of text) {
    const { from, to } = editor.editor.state.selection;
    const handled = editor.editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.editor.view, from, to, character, () => editor.editor.state.tr),
    );
    if (!handled) {
      editor.editor.view.dispatch(editor.editor.state.tr.insertText(character, from, to));
    }
  }
}

function typed(text: string): { html: string; markdown: string } {
  const editor = emptyEditor();
  typeText(editor, text);
  return { html: editor.editor.getHTML(), markdown: editor.getMarkdown().trim() };
}

describe('a typed code span keeps the character before it', () => {
  it.each([
    ['a letter', 'ax`code` b', '<p>ax<code>code</code> b</p>'],
    ['a digit', 'a1`code` b', '<p>a1<code>code</code> b</p>'],
    ['an opening parenthesis', '(`code`) b', '<p>(<code>code</code>) b</p>'],
    ['a quotation mark', '"`code`" b', '<p>"<code>code</code>" b</p>'],
    ['a tilde', 'a ~`code` b', '<p>a ~<code>code</code> b</p>'],
    ['a slash', 'a/`code` b', '<p>a/<code>code</code> b</p>'],
    ['the same letter as the span', 'c`c` b', '<p>c<code>c</code> b</p>'],
    ['two spans in parentheses', '(`a` and `b`) c', '<p>(<code>a</code> and <code>b</code>) c</p>'],
  ])('after %s', (_name, text, html) => {
    const result = typed(text);
    expect(result.html).toBe(html);
    expect(result.markdown).toBe(text);
  });
});

describe('a span is made where it was made before, and nowhere else', () => {
  it('at a line start and after a space', () => {
    expect(typed('`code` b').html).toBe('<p><code>code</code> b</p>');
    expect(typed('a `code` b').html).toBe('<p>a <code>code</code> b</p>');
  });

  it('not from a run of two backticks', () => {
    expect(typed('a ``code`` b').html).toBe('<p>a ``code`` b</p>');
    expect(typed('a ``x` b').html).toBe('<p>a ``x` b</p>');
  });

  it('not carried on to what is typed after the span', () => {
    expect(typed('ax`code` and more').html).toBe('<p>ax<code>code</code> and more</p>');
  });
});

describe('the rule is undone as every input rule is (R-C16)', () => {
  it('gives back the typed text on a Backspace right after it', () => {
    const editor = emptyEditor();
    typeText(editor, 'ax`code`');
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    editor.editor.view.someProp('handleKeyDown', (handler) => handler(editor.editor.view, event));
    expect(editor.editor.getHTML()).toBe('<p>ax`code`</p>');
  });

  it('takes the span back in one undo, to the text before the closing backtick', () => {
    const editor = emptyEditor();
    typeText(editor, '(`code`');
    expect(editor.editor.getHTML()).toBe('<p>(<code>code</code></p>');
    editor.editor.commands.undo();
    expect(editor.editor.getHTML()).toBe('<p>(`code</p>');
  });
});
