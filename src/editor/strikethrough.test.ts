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
    // Was a #84 exception below until the `Code` mark stopped excluding every
    // other one: the strike used to be split around the span in the document
    // model, before turndown saw anything. Now the file's own spelling survives
    // at the editor level as well as through the pair (#84).
    ['strike spanning an inline code span', '~~a `code` b~~'],
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
 * #84, not #85: two marks that overlap have exactly one nesting in the editor's
 * document model, so a strike that meets a link — or a bold — comes out spelled
 * the way the schema ranks them rather than the way the file spelled it.
 * **Nothing is lost**: the strike still covers the same words, which is what
 * makes these #84's re-nesting finding rather than this issue's. Pinned so that
 * a regression which dropped the strike would fail here rather than pass
 * quietly.
 *
 * Both shapes are byte-identical through the pair
 * (`markdown/roundtrip.test.ts`), which is exactly how the split was made, and
 * both are recorded in REQUIREMENTS under R-C2 with the constraint that decided
 * them: the nesting can be swapped but not removed.
 *
 * A third shape stood here — `~~a `code` b~~` split around the span — until the
 * `Code` mark stopped excluding every other mark (#84). It is byte-identical
 * now and has moved into the list above.
 */
describe('KNOWN EXCEPTION (#84): strike and another mark have one nesting', () => {
  it.each([
    ['bold inside strike becomes strike inside bold', '~~**x**~~', '**~~x~~**'],
    [
      'a link inside strike becomes strike inside the link',
      '~~[t](https://example.com)~~',
      '[~~t~~](https://example.com)',
    ],
  ])('%s', (_label, input, expected) => {
    const editor = editorWith(input);
    expect(editor.getMarkdown().trim()).toBe(expected);
  });
});
