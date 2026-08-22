import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

/**
 * #85 at the level the user meets it: strikethrough must survive open → save,
 * and strikethrough applied from the floating toolbar must reach the file.
 *
 * This goes through the **editor** — `setMarkdown` → ProseMirror → `getMarkdown`
 * — as well as through the parser/serializer pair that
 * `markdown/roundtrip.test.ts` covers, because the two ends produce different
 * markup: `marked` emits `<del>`, TipTap's `Strike` renders `<s>`, and the
 * toolbar route never touches the parser at all. Turndown had no rule for
 * either spelling, so on `a9aab02` every case below came back with the strike
 * gone — `~~gone~~` saved as `gone`, and a word struck through with the
 * toolbar's own `S` button saved as plain text.
 */
let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('strikethrough survives the editor (R-C2)', () => {
  it.each([
    ['a whole line', '~~gone~~'],
    ['a word inside a sentence', 'a ~~b~~ c'],
    ['more than one word', '~~two words~~'],
    ['strike inside bold', '**~~x~~**'],
    ['strike inside italics', '*~~x~~*'],
    ['strike inside a link', '[~~t~~](https://example.com)'],
  ])('keeps %s unchanged on open → save', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });

  it('leaves tildes inside inline code alone', () => {
    const editor = editorWith('`~~a~~`');
    expect(editor.getMarkdown().trim()).toBe('`~~a~~`');
  });

  it('KNOWN EXCEPTION: single-tilde strikethrough is written with two', () => {
    // Recorded in REQUIREMENTS under R-C2, and pinned at the pair level too:
    // the mark does not carry the delimiter the file used.
    const editor = editorWith('a ~b~ c');
    expect(editor.getMarkdown().trim()).toBe('a ~~b~~ c');
  });
});

describe('the toolbar route reaches the file (#85)', () => {
  it('writes ~~…~~ for a word struck through with toggleStrike', () => {
    // What the floating toolbar's S button runs (src/ui/toolbar.ts).
    const editor = editorWith('hello world');
    editor.editor.chain().focus().setTextSelection({ from: 1, to: 6 }).toggleStrike().run();
    expect(editor.editor.isActive('strike')).toBe(true);
    expect(editor.getMarkdown().trim()).toBe('~~hello~~ world');
  });

  it('takes the tildes back out when the same button is pressed again', () => {
    const editor = editorWith('~~hello~~ world');
    editor.editor.chain().focus().setTextSelection({ from: 1, to: 6 }).toggleStrike().run();
    expect(editor.getMarkdown().trim()).toBe('hello world');
  });
});

/**
 * #84, not #85: TipTap re-orders nested marks and its `Code` mark excludes
 * every other mark, so a strike that meets a link or an inline code span comes
 * out of the editor spelled differently than it went in. **Nothing is lost** —
 * the strike survives on every fragment, which is what makes these #84's
 * re-nesting finding rather than this issue's. Pinned so that whoever fixes
 * #84 sees these change, and so that a regression that dropped the strike
 * again would fail here rather than pass quietly.
 *
 * The same three shapes are byte-identical through the pair
 * (`markdown/roundtrip.test.ts`), which is exactly how the split was made.
 */
describe('KNOWN EXCEPTION (#84): strike re-nests around links and inline code', () => {
  it.each([
    ['bold inside strike becomes strike inside bold', '~~**x**~~', '**~~x~~**'],
    [
      'a link inside strike becomes strike inside the link',
      '~~[t](https://example.com)~~',
      '[~~t~~](https://example.com)',
    ],
    ['strike splits around an inline code span', '~~a `code` b~~', '~~a~~ `code` ~~b~~'],
  ])('%s', (_label, input, expected) => {
    const editor = editorWith(input);
    expect(editor.getMarkdown().trim()).toBe(expected);
  });
});
