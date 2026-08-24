/**
 * #84's second half at the level the user meets it: a mark and an inline code
 * span, in the same run of text.
 *
 * On `522cc04` TipTap's `Code` mark carried `excludes: '_'` — it excluded every
 * other mark. ProseMirror's marks are flat and per text node, so
 * ``**bold `code` more**`` needs its middle text node to carry `bold` *and*
 * `code`, and that rule forbade it: the bold run was split around the span in
 * the **document model**, before turndown was involved at all. Where the mark's
 * whole extent *was* the code span there was nowhere left to put it and it was
 * dropped — which is the half that lost something the reader can see.
 *
 * Narrowing `excludes` alone was measured and rejected: at its default priority
 * `code` outranks `italic`, `strike` and `underline`, so the mark landed
 * *inside* the backticks and ``~~a `code` b~~`` was written as
 * ``~~a~~ `~~code~~` ~~b~~``, where the tildes are four literal characters in a
 * code span rather than markup. `code` is therefore also ranked below every
 * other mark, so a code span is always innermost and every mark is written
 * outside its backticks — the only nesting CommonMark can spell.
 *
 * The link half of #84 is **not** fixed and is not fixable this way; it is
 * recorded in REQUIREMENTS under R-C2 with the measurement that decided it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

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

describe('a mark and a code span survive each other (#84)', () => {
  it.each([
    ['strong spanning a code span', '**bold `code` more**'],
    ['emphasis spanning a code span', '*a `c` b*'],
    ['strike spanning a code span', '~~a `code` b~~'],
    ['emphasis and strong spanning a code span', '***a `c` b***'],
    ['an underline spanning a code span', 'a <u>x `c` y</u> b'],
    ['a link and strong spanning a code span', '[**a `c` b**](https://e.com)'],
  ])('keeps %s byte-identical', (_label, markdown) => {
    expect(editorWith(markdown).getMarkdown().trim()).toBe(markdown);
  });

  it.each([
    ['strong whose whole extent is a code span', '**`c`**'],
    ['emphasis whose whole extent is a code span', '*`c`*'],
    ['strike whose whole extent is a code span', '~~`c`~~'],
    ['a link whose whole text is a code span', '[`c`](https://e.com)'],
  ])('no longer drops %s', (_label, markdown) => {
    // The visible losses on `522cc04`, and the reason this half is a fix rather
    // than an exception: each of these came back as ``` `c` ``` — the emphasis
    // gone, and in the last case a **link destination gone out of the user's
    // file**. `excludes: '_'` left the mark nowhere to live, so it was dropped
    // on the way into the document model.
    expect(editorWith(markdown).getMarkdown().trim()).toBe(markdown);
  });

  it('writes the mark outside the backticks, never inside them', () => {
    // What the rank buys, stated as the property rather than as a list of
    // outputs. A mark written inside a code span is not a respelling: the
    // delimiters stop being markup and become characters the reader sees.
    for (const markdown of ['~~a `c` b~~', '*a `c` b*', 'a <u>x `c` y</u> b']) {
      const saved = editorWith(markdown).getMarkdown().trim();
      const spans = saved.match(/`[^`]*`/g) ?? [];
      expect(spans.length).toBeGreaterThan(0);
      for (const span of spans) expect(span).not.toMatch(/[*~_]|<u>/);
      instance?.destroy();
      instance = null;
    }
  });
});

/**
 * What narrowing `excludes` makes **reachable from the toolbar**, measured
 * rather than assumed, because it is a change to what the editor permits and
 * not only to what it writes.
 *
 * On `522cc04` the Bold button was simply dead inside a code span — `can()`
 * answered false and nothing happened — and pressing Code over a bold run
 * silently removed the bold. Both are gone. What is reachable now is emphasis
 * that covers a code span, which is ordinary CommonMark, and emphasis that
 * covers *part* of one, which CommonMark cannot spell as a single span. The
 * serializer's answer to the second is named in its own test below.
 */
describe('the toolbar routes (#84)', () => {
  it('applies bold across a selection that contains a code span', () => {
    const editor = editorWith('abc `code` def');
    editor.editor.chain().focus().setTextSelection({ from: 1, to: 15 }).toggleBold().run();
    expect(editor.getMarkdown().trim()).toBe('**abc `code` def**');
  });

  it('applies bold to exactly a code span', () => {
    const editor = editorWith('abc `code` def');
    editor.editor.chain().focus().setTextSelection({ from: 5, to: 9 }).toggleBold().run();
    expect(editor.getMarkdown().trim()).toBe('abc **`code`** def');
  });

  it('keeps the bold when Code is applied over a bold run', () => {
    // On `522cc04` this answered ``` `abc` def ``` — the bold removed by the
    // schema, with nothing said about it.
    const editor = editorWith('**abc** def');
    editor.editor.chain().focus().setTextSelection({ from: 1, to: 4 }).toggleCode().run();
    expect(editor.getMarkdown().trim()).toBe('**`abc`** def');
  });

  it('offers Bold inside a code span at all', () => {
    const editor = editorWith('abc `code` def');
    editor.editor.chain().focus().setTextSelection({ from: 5, to: 9 }).run();
    expect(editor.editor.isActive('code')).toBe(true);
    // False on `522cc04`: the button was there and did nothing.
    expect(editor.editor.can().toggleBold()).toBe(true);
  });

  it('NAMED CASE: emphasis over part of a code span is written as separate spans', () => {
    // The one shape CommonMark cannot spell. A code span's content is literal,
    // so there is no way to emphasise a *piece* of one; the serializer ends the
    // span, writes the emphasised piece as its own span inside the delimiters,
    // and opens a new one — which is what the marks say and what re-reading it
    // gives back.
    //
    // **Nothing is lost and nothing drifts**: the words, the monospace and the
    // emphasis all survive, and the second save moves nothing. What the reader
    // sees change is one code span becoming three adjacent ones. It is
    // reachable only by selecting part of a code span deliberately.
    //
    // **Owner decision, 2026-08-24**, taken on this branch's Windows build with
    // the gesture in front of them: the behaviour stays as measured and the
    // editor does not refuse the gesture. Recorded in REQUIREMENTS under R-C1,
    // so this is a pinned decision rather than an open question — anyone
    // changing what is written here is changing a product decision, not a
    // detail.
    const editor = editorWith('abc `code` def');
    editor.editor.chain().focus().setTextSelection({ from: 6, to: 8 }).toggleBold().run();
    const saved = editor.getMarkdown().trim();
    expect(saved).toBe('abc `c`**`od`**`e` def');
    editor.destroy();
    instance = null;

    // Deliberate, not incidental: re-reading it gives the same document back.
    expect(editorWith(saved).getMarkdown().trim()).toBe(saved);
  });
});

/**
 * The kit is read rather than restated (`src/editor/setup.ts`), so this is what
 * says the reading still holds. If `StarterKit` ever stops registering a mark
 * called `code`, the editor throws at construction with a named cause — but a
 * *renamed* rank or a re-introduced `excludes` would otherwise come back
 * silently, and every shape above would quietly go back to being split.
 */
describe('the schema the fix depends on', () => {
  it('ranks the code mark below every other mark, and excludes none of them', () => {
    const editor = editorWith('');
    const marks = Object.keys(editor.schema.marks);
    expect(marks[marks.length - 1]).toBe('code');
    expect(editor.schema.marks.code.spec.excludes).toBe('');
  });

  it('configuration survives the extend', () => {
    // The regression this file exists to prevent a second time. Re-declaring
    // the `Code` mark means reaching into StarterKit's own extension list, and
    // `StarterKit.extend({…}).configure({…})` builds that list from the kit's
    // *default* options — every value `setup.ts` passes is dropped, silently.
    // Measured on this branch before the order was corrected: `heading` came
    // back as levels 1–6 rather than 1–4, and the code block lost the
    // `code-block` class. Neither threw, and no test in the suite failed,
    // because both are configuration rather than behaviour —
    // `numbered-heading.test.ts` even carries a comment asserting the level
    // limit in prose, which had quietly become false.
    //
    // **Of the two, only the heading levels had a user-visible consequence.**
    // Nothing styles `.code-block`: a fenced block's appearance comes from
    // `.tiptap pre` in `src/styles.css`, which never mentions that class. It is
    // asserted anyway, because the claim being pinned is *the configuration is
    // what `setup.ts` asked for* — but it is not evidence about how anything
    // looks, and an earlier version of this comment wrongly said it was.
    //
    // Asserted here rather than in the round-trip table on purpose: the table
    // is about bytes, and neither of these reaches the file.
    const editor = editorWith('');
    const extensions = editor.editor.extensionManager.extensions;
    const optionsOf = (name: string) =>
      extensions.find((extension) => extension.name === name)?.options as
        | Record<string, unknown>
        | undefined;

    expect((optionsOf('heading') as { levels?: number[] } | undefined)?.levels).toEqual([
      1, 2, 3, 4,
    ]);
    expect(
      (optionsOf('codeBlock') as { HTMLAttributes?: Record<string, unknown> } | undefined)
        ?.HTMLAttributes,
    ).toEqual({ class: 'code-block' });
  });

  it('keeps a heading level the editor does not have out of the schema', () => {
    // The user-visible half of the same fact, stated as behaviour rather than
    // as configuration: `#####` is not a heading here, so it opens as a
    // paragraph. Not an endorsement of the limit — STATUS §4 records that the
    // limit itself is unpinned on purpose — but a check that the limit
    // `setup.ts` asks for is the limit the editor got.
    const editor = editorWith('##### Five');
    expect(Object.keys(editor.schema.nodes)).toContain('heading');
    expect(editor.editor.getHTML()).not.toContain('<h5');
  });

  it('gives a fenced block the class setup.ts asks for', () => {
    // Deliberately *not* titled after styling. The class reaches the HTML, and
    // that is all this asserts; `src/styles.css` styles `.tiptap pre` and does
    // not mention `.code-block` anywhere, so this class is configuration
    // nothing currently consumes. Found by the owner's manual check on
    // 2026-08-24, against a step that had asked him for a border the
    // application never draws — the same shape of error as #103.
    const editor = editorWith('```js\nx\n```');
    expect(editor.editor.getHTML()).toContain('class="code-block"');
  });
});
