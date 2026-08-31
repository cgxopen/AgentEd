/**
 * The plain text box of R-C15 (#210): a fence with no language wraps its
 * lines instead of scrolling sideways.
 *
 * ── What these tests can and cannot see, stated first ──
 *
 * **Whether a line wraps is layout, and happy-dom has none.** It is the
 * same wall #205 and #209 met with `offsetParent`. So the wrapping itself
 * is not asserted here and cannot be: it rests on the manual pass, and
 * the pull request says so without softening it.
 *
 * What is left has to be split into halves that do not imply each other,
 * because either alone is the decorative assertion this repository has
 * collected ten of:
 *
 *  - a test that the stylesheet contains a rule has not shown the rule
 *    reaches any element;
 *  - a test that an element carries a class has not shown any rule
 *    reaches it.
 *
 * So both are here, and so is the join: the selector is **read out of
 * `styles.css`** and then run against the element the editor actually
 * rendered, with `matches`. A selector that stopped matching, or an
 * element that stopped being rendered that way, turns this red — which is
 * the one thing neither half can do alone. `matches` is DOM query, not
 * layout, so happy-dom answers it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { insertCodeBlock } from './insert-code-block';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

function open(markdown: string): EditorInstance {
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
  for (const sheet of document.head.querySelectorAll('style')) {
    sheet.remove();
  }
});

/**
 * Feed text the way a keypress does, so the markdown input rules run.
 * `insertContent` does not go through them, so a test written with it
 * would assert nothing about the route a user takes. Same helper, same
 * reason, as `code-block-language.test.ts`.
 */
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

/** The `code` element the editor drew for the first fenced block. */
function renderedCode(editor: EditorInstance): HTMLElement {
  const code = editor.editor.view.dom.querySelector('pre > code');
  if (!code) throw new Error('the editor rendered no fenced block');
  return code as HTMLElement;
}

/**
 * The wrapping rule as it is written in `styles.css`, split into the
 * selector and its body.
 *
 * Found by its declarations rather than by its selector, so that the
 * selector this file asserts on is the one the stylesheet carries rather
 * than one repeated here. If the rule is renamed, moved or rewritten,
 * what follows is measured against the new text or fails to find it.
 */
function wrappingRule(): { selector: string; body: string } {
  const blocks = stylesCss.split('}');
  const block = blocks.find(
    (candidate) =>
      candidate.includes('white-space: pre-wrap') && candidate.includes('overflow-wrap'),
  );
  if (!block) throw new Error('styles.css carries no rule that wraps and breaks words');
  const brace = block.lastIndexOf('{');
  const beforeBrace = block.slice(0, brace);
  // The selector is the last line before the brace; everything above it
  // is the comment the rule is documented with.
  const selector =
    beforeBrace
      .split('\n')
      .filter((line) => line.trim() !== '')
      .pop() ?? '';
  return { selector: selector.trim(), body: block.slice(brace + 1) };
}

describe('the rule in the stylesheet', () => {
  it('wraps and breaks long runs, which is the owner decision of 2026-08-31', () => {
    const { body } = wrappingRule();
    expect(body).toContain('white-space: pre-wrap');
    // Wrap at spaces, and break inside a run only when it has nowhere else
    // to go. `anywhere` would break the same way and also change how the
    // block negotiates width, which is not what was decided.
    expect(body).toContain('overflow-wrap: break-word');
    expect(body).not.toContain('overflow-wrap: anywhere');
  });

  it('is aimed at a fenced block with no language', () => {
    const { selector } = wrappingRule();
    expect(selector).toBe('.tiptap pre > code:not([class*="language-"])');
  });

  it('leaves the sideways scroll on the block itself', () => {
    // The container still scrolls; what changed is that a wrapped block
    // no longer gives it anything to scroll. A rule that had removed this
    // would have changed the block with a language too.
    const preRule = stylesCss.split('}').find((block) => block.includes('.tiptap pre {'));
    expect(preRule).toContain('overflow-x: auto');
  });
});

describe('the rendered tree, and the rule reaching it', () => {
  it('renders a fence with no language as an element the rule matches', () => {
    const editor = open('```\njust some text\n```\n');
    const code = renderedCode(editor);
    const { selector } = wrappingRule();

    // Half one: the shape. Half two: the rule in the file. The join: the
    // selector out of that file, run against this element.
    expect(code.className).toBe('');
    expect(code.matches(selector)).toBe(true);
  });

  it('renders a fence with a language as an element the rule does not match', () => {
    const editor = open('```ts\nconst x = 1;\n```\n');
    const code = renderedCode(editor);
    const { selector } = wrappingRule();

    expect(code.className).toBe('language-ts');
    // Asserted separately from the case above, so a change that widened
    // the rule to every fence names itself here instead of hiding.
    expect(code.matches(selector)).toBe(false);
  });

  it('treats a fence written as ```text as one with a language', () => {
    // R-C15 says the picker offers *Text* for a block with none, so a
    // block that names `text` in the file has said something and keeps
    // scrolling. The distinction is what the file spells, not what it
    // means.
    const editor = open('```text\njust some text\n```\n');
    expect(renderedCode(editor).matches(wrappingRule().selector)).toBe(false);
  });

  it('treats an indented block as one with no language', () => {
    // Four-space indentation carries no info string, so there is nothing
    // to name, and it opens as a fence with no language.
    const editor = open('    indented code\n');
    expect(renderedCode(editor).matches(wrappingRule().selector)).toBe(true);
  });
});

describe('a block made in the editor is a plain text box at once', () => {
  it('when it is typed as three backticks and a space', () => {
    const editor = open('');
    typeText(editor, '``` ');

    expect(editor.editor.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe(null);
    expect(renderedCode(editor).matches(wrappingRule().selector)).toBe(true);
  });

  it('when it is made by the command behind Ctrl+Shift+K and the Edit menu', () => {
    // The one address #205 extracted: the shortcut, the menu entry and the
    // toolbar button all end here, so driving it is driving all three.
    const editor = open('');
    insertCodeBlock(editor.editor);

    expect(editor.editor.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe(null);
    expect(renderedCode(editor).matches(wrappingRule().selector)).toBe(true);
  });
});

describe('nothing about the box reaches the file (R-C2)', () => {
  it('saves a document holding both kinds of fence byte for byte', () => {
    const source = '```\nplain box\n```\n\n```ts\nconst x = 1;\n```';
    const editor = open(`${source}\n`);
    // The rule is a stylesheet selector and nothing else: no attribute, no
    // node view, no schema change, so the serializer is handed a document
    // that has never heard of it. Asserted on its output all the same.
    expect(editor.getMarkdown()).toBe(source);
  });

  it('leaves the text of a long line exactly as it was written', () => {
    // A soft wrap is a line-box decision and adds no character, so what is
    // selected and copied is the original text. The document model is the
    // layer that answers, and CSS never reaches it.
    const line = 'a very long line of prose that a browser would lay out over several rows';
    const editor = open(`\`\`\`\n${line}\n\`\`\`\n`);
    const doc = editor.editor.state.doc;

    expect(doc.textBetween(0, doc.content.size, '\n')).toBe(`${line}\n`);
    expect(renderedCode(editor).textContent).toBe(`${line}\n`);
    expect(editor.getMarkdown()).toBe(`\`\`\`\n${line}\n\`\`\``);
  });
});

/**
 * The cascade, run rather than reasoned about.
 *
 * `matches` above proves the selector in `styles.css` picks out the
 * element the editor renders. This goes one step further and puts the
 * stylesheet into the document, so the answer comes from a CSS engine
 * resolving specificity and order rather than from a selector test. It is
 * the strongest join available here, and it is still **not layout**:
 * whether a line actually breaks is a decision no test in this repository
 * can see.
 *
 * **`overflow-wrap` is what is read, and `white-space` deliberately is
 * not.** happy-dom computes `white-space: pre-wrap` for a fenced block
 * with a language too, which a real browser does not — its user-agent
 * value for `pre` is `pre`. Nothing else in the sheet declares
 * `overflow-wrap`, so that one property tells the two apart honestly
 * here, and asserting on the other would be asserting on a quirk of the
 * harness.
 */
describe('the cascade, with the stylesheet in the document', () => {
  function withStylesheet(markdown: string): HTMLElement[] {
    const style = document.createElement('style');
    style.textContent = stylesCss;
    document.head.appendChild(style);
    const editor = open(markdown);
    return Array.from(editor.editor.view.dom.querySelectorAll('pre > code'));
  }

  it('gives the block with no language the break, and the one with a language none', () => {
    const [plain, withLanguage] = withStylesheet(
      '```\nplain box\n```\n\n```ts\nconst x = 1;\n```\n',
    );

    expect(window.getComputedStyle(plain).overflowWrap).toBe('break-word');
    expect(window.getComputedStyle(withLanguage).overflowWrap).toBe('');
  });
});
