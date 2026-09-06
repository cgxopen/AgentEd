/**
 * A fenced block shows a copy icon on hover (R-C15, #235).
 *
 * ── The half this harness cannot observe, said first ──
 *
 * happy-dom lays nothing out and has no pointer, so **whether the icon is
 * actually hidden until the block is hovered is not observable here**. Nothing
 * below asserts it. What is asserted are the two halves that *are* observable,
 * joined so that neither can be satisfied alone:
 *
 *  1. the selectors are **read out of `src/styles.css`** rather than restated,
 *     so a rename in the stylesheet turns this file red; and
 *  2. those selectors are run against **the element the editor actually
 *     rendered**, in both directions — every icon reached, nothing else.
 *
 * Either half on its own asserts nothing. A rule can name a class no element
 * carries, and an element can carry a class no rule reaches; the join is what
 * rules out both. The #164 shape.
 *
 * **The manual pass is where the hover is verified**, not merely confirmed:
 * the icon appearing when the pointer enters the block and going when it
 * leaves is a thing a person sees on the Windows artifact, and no assertion
 * here stands in for it.
 *
 * ── Everything else runs the ordinary open path ──
 *
 * `createEditor` plus `setMarkdown`, then the editor's own rendered DOM and its
 * own model — so a stub of the decoration cannot produce the evidence. The
 * #146 lesson, the same way `code-block-language.test.ts` takes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import stylesCss from '../styles.css?raw';
import { copyText } from '../ui/clipboard';
import { showToast } from '../ui/toast';
import { COPY_BUTTON_CLASS, COPY_FEEDBACK_MS } from './code-block-copy';
import { LANGUAGE_LABEL_CLASS } from './code-block-language';
import { htmlToMarkdown } from './markdown/serialize';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

const copyTextMock = vi.mocked(copyText);
const showToastMock = vi.mocked(showToast);

let instance: EditorInstance | null = null;

function open(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

function buttons(editor: EditorInstance): HTMLButtonElement[] {
  return Array.from(editor.editor.view.dom.querySelectorAll(`.${COPY_BUTTON_CLASS}`));
}

/** Which of the two glyphs the button is showing right now. */
function glyphOf(button: HTMLButtonElement): string | null {
  return button.querySelector('svg')?.getAttribute('data-glyph') ?? null;
}

/** A click, and the microtasks the clipboard promise needs to settle. */
async function click(button: HTMLButtonElement): Promise<void> {
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** Open, click the first block's icon, and report what reached the clipboard. */
async function copiedFrom(markdown: string, index = 0): Promise<string | undefined> {
  const editor = open(markdown);
  await click(buttons(editor)[index]);
  const [text] = copyTextMock.mock.calls.at(-1) ?? [];
  editor.destroy();
  instance = null;
  return text;
}

function openAndSave(markdown: string): string {
  const editor = open(markdown);
  const saved = editor.getMarkdown().trim();
  editor.destroy();
  instance = null;
  return saved;
}

beforeEach(() => {
  copyTextMock.mockReset();
  copyTextMock.mockResolvedValue(true);
  showToastMock.mockReset();
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// The stylesheet, joined to the rendered element
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every rule in `styles.css`, as a selector and the declarations under it. The
 * body is what follows the opening brace, so a comment written above a rule
 * belongs to neither half — which matters here, because the comment above these
 * rules names this file by name.
 */
function allRules(): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  for (const block of stylesCss.split('}')) {
    const brace = block.lastIndexOf('{');
    if (brace === -1) continue;
    const selector =
      block
        .slice(0, brace)
        .split('\n')
        .filter((line) => line.trim() !== '')
        .pop() ?? '';
    rules.push({ selector: selector.trim(), body: block.slice(brace + 1) });
  }
  return rules;
}

/** The rules whose **selector** names this class — not the ones that mention it. */
function copyRules(): Array<{ selector: string; body: string }> {
  return allRules().filter((rule) => rule.selector.includes(COPY_BUTTON_CLASS));
}

describe('the stylesheet rules and the rendered icon are the same thing (#164 shape)', () => {
  const DOCUMENT = '```python\nx = 1\n```\n\n```\nplain\n```';

  it('styles.css carries exactly two rules for the class the plugin writes', () => {
    // Two, and the count is asserted rather than the presence: the icon is
    // sized by attribute on the SVG precisely so a third rule cannot drift in
    // and quietly become the one that decides whether it is visible.
    expect(copyRules().map((rule) => rule.selector)).toHaveLength(2);
  });

  it('one of them hides it and takes it out of hit-testing', () => {
    const base = copyRules().find((rule) => !rule.selector.includes(':hover'));
    expect(base).toBeDefined();
    expect(base?.body).toContain('visibility: hidden');
    expect(base?.body).toContain('position: absolute');
    // The label of #202 cannot take a click and says so in the sheet. This one
    // exists to take one, so the declaration that would forbid it is absent.
    expect(base?.body).not.toContain('pointer-events: none');
  });

  it('the other is a hover rule, and it is the whole of the hover behaviour', () => {
    // The assertion the first reversal reddens: remove the hover rule from
    // `styles.css` and the icon is in the DOM, styled, and invisible forever.
    // No code changes, every other test in this file stays green, and this one
    // fails.
    const hover = copyRules().find((rule) => rule.selector.includes(':hover'));
    expect(hover).toBeDefined();
    expect(hover?.selector).toContain('pre:hover');
    expect(hover?.body).toContain('visibility: visible');
  });

  it('the hover selector, read from the sheet, reaches every icon the editor drew', () => {
    const hover = copyRules().find((rule) => rule.selector.includes(':hover'));
    if (hover === undefined) throw new Error('styles.css carries no hover rule for the copy icon');

    // `:hover` is a pointer state this harness has no way to enter, so it is
    // removed and the rest of the selector — the structure it depends on — is
    // run against the tree the editor built. That structure is the half a
    // stylesheet can get wrong on its own.
    const structural = hover.selector.replace(':hover', '');
    const editor = open(DOCUMENT);
    const reached = Array.from(editor.editor.view.dom.ownerDocument.querySelectorAll(structural));

    expect(reached.length).toBe(2);
    expect(reached).toEqual(buttons(editor));
  });

  it('and reaches nothing else in the rendered document', () => {
    const base = copyRules().find((rule) => !rule.selector.includes(':hover'));
    if (base === undefined) throw new Error('styles.css carries no base rule for the copy icon');

    const editor = open(`${DOCUMENT}\n\ntext with \`inline code\`\n\n> quote`);
    const reached = Array.from(
      editor.editor.view.dom.ownerDocument.querySelectorAll(base.selector),
    );

    // The other direction: everything the rule picks out is one of the buttons
    // the plugin drew, and nothing in the document has drifted into its reach.
    expect(reached.length).toBeGreaterThan(0);
    expect(reached).toEqual(buttons(editor));
    for (const element of reached) {
      expect(element.closest('pre')).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What is copied — the model, never the DOM
// ─────────────────────────────────────────────────────────────────────────────

describe('a click copies the text of the block, read from the model', () => {
  it('a fence with a language — and the label is not in it', async () => {
    // The row the second reversal reddens. Through the DOM this reads
    // `pythonprint(1)\n`: the widget of #202 is drawn at `pos + 1`, which puts
    // it inside the rendered `<code>`, so `code.textContent` carries it too.
    expect(await copiedFrom('```python\nprint(1)\n```')).toBe('print(1)\n');
  });

  it('a fence with no language', async () => {
    expect(await copiedFrom('```\nplain text\n```')).toBe('plain text\n');
  });

  it('leading whitespace on the first line survives', async () => {
    expect(await copiedFrom('```js\n    indented()\nsecond\n```')).toBe('    indented()\nsecond\n');
  });

  it('a line of three backticks inside the block', async () => {
    // Not a label case — this fence has none — so a DOM-reading copy passes it.
    // What it catches is a copy that hands back the *serialized* block: that
    // route would write the outer fence and the language line, and this is the
    // content that makes the two spellings differ.
    expect(await copiedFrom('````\nline\n```\nafter\n````')).toBe('line\n```\nafter\n');
  });

  it('an empty fence copies exactly what the model holds', async () => {
    // Owner decision, 2026-09-06: the model text verbatim, trailing newline
    // and all, rather than a trim that would make the copy edit what it copies.
    expect(await copiedFrom('```ts\n```')).toBe('\n');
  });

  it('the label of the block is measurably absent from what was copied', async () => {
    const editor = open('```python\nprint(1)\n```');
    const pre = editor.editor.view.dom.querySelector('pre');
    const label = pre?.querySelector(`.${LANGUAGE_LABEL_CLASS}`);

    // The floor under the row above: the label really is inside this DOM, so
    // the assertion that it is not in the copied text is a statement about the
    // route rather than about a document that never had one.
    expect(label?.textContent).toBe('python');
    expect(pre?.textContent).toContain('python');

    await click(buttons(editor)[0]);
    const [text] = copyTextMock.mock.calls.at(-1) ?? [];
    expect(text).not.toContain('python');
  });

  it('the second block copies the second block', async () => {
    const document = '```py\nfirst\n```\n\n```sh\nsecond\n```';
    expect(await copiedFrom(document, 1)).toBe('second\n');
  });

  it('copies the text as it is at the moment of the click, not as it was', async () => {
    const editor = open('```python\nx = 1\n```');
    editor.editor.commands.focus('end');
    editor.editor.commands.insertContent('y = 2');

    await click(buttons(editor)[0]);
    const [text] = copyTextMock.mock.calls.at(-1) ?? [];
    expect(text).toBe('x = 1\ny = 2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The click itself — feedback, and the paths that fail
// ─────────────────────────────────────────────────────────────────────────────

describe('the click gives feedback and moves no caret', () => {
  it('the glyph becomes a check and goes back on its own', async () => {
    const editor = open('```python\nx = 1\n```');
    const button = buttons(editor)[0];
    expect(glyphOf(button)).toBe('clipboard');

    vi.useFakeTimers();
    try {
      await click(button);
      expect(glyphOf(button)).toBe('check');

      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
      expect(glyphOf(button)).toBe('clipboard');
    } finally {
      vi.useRealTimers();
    }
  });

  it('mousedown is cancelled, so the browser places no selection from it', () => {
    const editor = open('```python\nx = 1\n```');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    buttons(editor)[0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('the button is out of the tab order and keeps the caret out of itself', () => {
    const editor = open('```python\nx = 1\n```');
    const button = buttons(editor)[0];
    expect(button.getAttribute('contenteditable')).toBe('false');
    expect(button.getAttribute('tabindex')).toBe('-1');
    // It has a name, unlike the label, which is `aria-hidden`. A control that
    // does something is not chrome to a screen reader even when it is chrome
    // to the document.
    expect(button.getAttribute('aria-label')).not.toBeNull();
  });

  it('a refused clipboard write is told to the user, not swallowed', async () => {
    copyTextMock.mockResolvedValue(false);
    const editor = open('```python\nx = 1\n```');
    const button = buttons(editor)[0];

    await click(button);

    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock.mock.calls[0][1]).toBe('warn');
    // And the check is not shown for a copy that did not happen.
    expect(glyphOf(button)).toBe('clipboard');
  });

  it('a block with no text at all says so rather than reporting a failure', async () => {
    const editor = open('```ts\n```');
    // A fence opened from a file holds a newline; this is the model a block
    // built in the editor can reach, and `copyText` refuses the empty string.
    editor.editor.commands.selectAll();
    editor.editor.commands.deleteSelection();
    editor.setMarkdown('');
    editor.editor.commands.insertContent({ type: 'codeBlock', attrs: { language: null } });

    const button = buttons(editor)[0];
    await click(button);

    expect(copyTextMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock.mock.calls[0][1]).toBe('warn');
    // Which of the two refusals it was: an empty block, not a missing one.
    expect(showToastMock.mock.calls[0][0]).toContain('empty');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Which blocks get one — every fence, and nothing that is not a fence
// ─────────────────────────────────────────────────────────────────────────────

describe('the icon reaches every fenced block and nothing else', () => {
  const MIXED = [
    '# Fences',
    '',
    'A paragraph with `inline code` in it.',
    '',
    '```python',
    'x = 1',
    '```',
    '',
    '```',
    'no language here',
    '```',
    '',
    '- ```ts',
    '  const x = 1;',
    '  ```',
    '',
    '> ```sh',
    '> ls',
    '> ```',
  ].join('\n');

  it('one per fence, with a language or without', () => {
    const editor = open(MIXED);
    const pres = Array.from(editor.editor.view.dom.querySelectorAll('pre'));

    expect(pres.length).toBe(4);
    for (const pre of pres) {
      expect(pre.querySelectorAll(`.${COPY_BUTTON_CLASS}`).length).toBe(1);
    }
    expect(buttons(editor).length).toBe(4);
  });

  it('unlike the label, which only reaches the fences that have a language', () => {
    // The contrast is the point: R-C15 gives the plain text box the same Copy
    // button and no language label, so a build that drew the icon off the
    // language attribute would be wrong in a way no count of one document
    // catches.
    const editor = open(MIXED);
    const labels = editor.editor.view.dom.querySelectorAll(`.${LANGUAGE_LABEL_CLASS}`);
    expect(labels.length).toBe(3);
    expect(buttons(editor).length).toBe(4);
  });

  it('an inline code span gets nothing', () => {
    const editor = open('A paragraph with `inline code` in it.');
    const inline = editor.editor.view.dom.querySelector('code');

    expect(inline?.textContent).toBe('inline code');
    expect(inline?.closest('pre')).toBeNull();
    expect(buttons(editor).length).toBe(0);
  });

  it('every icon in the document sits inside a fenced block', () => {
    const editor = open(MIXED);
    for (const button of buttons(editor)) {
      expect(button.closest('pre')).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing reaches the file — the #202 assertion shape
// ─────────────────────────────────────────────────────────────────────────────

describe('the icon is chrome and reaches no file', () => {
  const DOCUMENT = [
    '# Fences',
    '',
    '```python',
    'x = 1',
    '```',
    '',
    '```',
    'no language here',
    '```',
    '',
    '- ```ts',
    '  const x = 1;',
    '  ```',
    '',
    '> ```sh',
    '> ls',
    '> ```',
    '',
    '```js',
    '```',
  ].join('\n');

  it('opens and saves a document of many fences byte for byte', () => {
    expect(openAndSave(DOCUMENT)).toBe(DOCUMENT);
  });

  it('is drawing five icons on that document while doing so', () => {
    // The floor under the test above: byte-identical would also be true of a
    // build that drew nothing at all, which is the half this pins.
    const editor = open(DOCUMENT);
    expect(buttons(editor).length).toBe(5);
  });

  it('is absent from getHTML, because a decoration is not in the document', () => {
    // The structural reason this holds rather than a test of it: `getHTML`
    // renders the model, and the model has never heard of the icon.
    const editor = open('```python\nx = 1\n```');
    expect(editor.editor.getHTML()).not.toContain(COPY_BUTTON_CLASS);
    expect(editor.editor.view.dom.innerHTML).toContain(COPY_BUTTON_CLASS);
  });

  it('never reaches the serialized markdown, asserted on the serializer', () => {
    const editor = open('```python\nx = 1\n```');
    const written = htmlToMarkdown(editor.editor.getHTML());

    expect(written).not.toContain(COPY_BUTTON_CLASS);
    expect(written).not.toContain('svg');
    expect(written.trim()).toBe('```python\nx = 1\n```');
  });
});
