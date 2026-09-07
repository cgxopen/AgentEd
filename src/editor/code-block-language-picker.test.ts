/**
 * The language label is a control (R-C15, #238).
 *
 * ── The half this harness cannot see, said first ──
 *
 * **Where the popover opens, and whether the mark is visible, are layout and
 * happy-dom has none**: every rectangle it reports is zero and it applies no
 * stylesheet, so an assertion about position or about a hover would assert
 * nothing. Those two are verified in the manual pass, and by the numbers
 * measured in Chromium on this branch and recorded on the issue.
 *
 * What *is* observable is asserted in both halves and joined, the #164 shape:
 * the selectors are read out of `styles.css` rather than restated here, and
 * they are run against the element the editor actually rendered. Either half
 * alone asserts nothing — a rule nothing matches, or an element no rule
 * reaches.
 */
import { afterEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import {
  activeLanguagePopover,
  closeLanguagePopover,
  LANGUAGE_ERROR_CLASS,
  LANGUAGE_FIELD_CLASS,
  LANGUAGE_HAS_BACKTICK,
  LANGUAGE_HAS_SPACE,
  LANGUAGE_POPOVER_CLASS,
  refusalFor,
} from '../ui/language-popover';
import {
  commitBlockLanguage,
  EMPTY_AFFORDANCE_CLASS,
  LANGUAGE_LABEL_CLASS,
} from './code-block-language';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

function open(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** The control the editor drew for the first fenced block. */
function control(editor: EditorInstance): HTMLElement {
  const element = editor.editor.view.dom.querySelector(
    `.${LANGUAGE_LABEL_CLASS}, .${EMPTY_AFFORDANCE_CLASS}`,
  );
  if (!element) throw new Error('the editor drew no language control');
  return element as HTMLElement;
}

function popover(): HTMLElement {
  const element = document.querySelector(`.${LANGUAGE_POPOVER_CLASS}`);
  if (!element) throw new Error('no popover is open');
  return element as HTMLElement;
}

function field(): HTMLInputElement {
  return popover().querySelector(`.${LANGUAGE_FIELD_CLASS}`) as HTMLInputElement;
}

function errorLine(): HTMLElement {
  return popover().querySelector(`.${LANGUAGE_ERROR_CLASS}`) as HTMLElement;
}

function click(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function press(element: HTMLElement, key: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/** Type into the field the way a user does, so the live refusal runs. */
function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * One rule out of the stylesheet, by its selector, as written. Read rather
 * than restated: a rename in `styles.css` turns this file red instead of
 * leaving an element in the DOM that nothing can see.
 */
function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`(^|[,}])\\s*${escaped}\\s*[,{]`, 'm'));
  if (!match) throw new Error(`styles.css declares no rule for ${selector}`);
  return match[0];
}

afterEach(() => {
  closeLanguagePopover();
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 — every fenced block has a control, and the two kinds differ
// ─────────────────────────────────────────────────────────────────────────────

describe('every fenced block carries a control (#238)', () => {
  it('a block with a language draws the label, with its text', () => {
    const editor = open('```python\nprint(1)\n```');
    const element = control(editor);

    expect(element.tagName).toBe('BUTTON');
    expect(element.classList.contains(LANGUAGE_LABEL_CLASS)).toBe(true);
    expect(element.textContent).toBe('python');
  });

  it('a block with no language draws the mark, as an icon and not a word', () => {
    // The owner decision of 2026-09-07: R-C15 says a fence with no language
    // carries no language label, so what appears here is an affordance.
    const editor = open('```\nplain\n```');
    const element = control(editor);

    expect(element.tagName).toBe('BUTTON');
    expect(element.classList.contains(EMPTY_AFFORDANCE_CLASS)).toBe(true);
    expect(element.textContent).toBe('');
    expect(element.querySelector('svg')?.getAttribute('data-glyph')).toBe('language');
  });

  it('both take a click and neither is hidden from assistive technology', () => {
    for (const markdown of ['```python\nx\n```', '```\nx\n```']) {
      const editor = open(markdown);
      const element = control(editor);

      expect(element.getAttribute('tabindex')).toBe('-1');
      expect(element.getAttribute('contenteditable')).toBe('false');
      expect(element.getAttribute('aria-hidden')).toBe(null);
      expect(element.getAttribute('aria-label')).toBeTruthy();

      editor.destroy();
      instance = null;
      document.body.innerHTML = '';
    }
  });

  it('a mousedown on it is cancelled, so no selection is placed first', () => {
    const editor = open('```python\nx\n```');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    control(editor).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the two halves joined: the stylesheet rule, run against the element
// ─────────────────────────────────────────────────────────────────────────────

describe('the rules that draw the control reach the element it drew (#238)', () => {
  it('the label rule matches the rendered label', () => {
    const editor = open('```python\nx\n```');

    expect(ruleFor(`.tiptap pre .${LANGUAGE_LABEL_CLASS}`)).toBeTruthy();
    expect(control(editor).matches(`.${LANGUAGE_LABEL_CLASS}`)).toBe(true);
  });

  it('the hover rule for a plain block names the class the editor rendered', () => {
    // The hover itself is not observable here; that the rule exists and that
    // it names this element is. The two together are the assertion.
    const editor = open('```\nx\n```');

    expect(ruleFor(`.tiptap pre:hover .${EMPTY_AFFORDANCE_CLASS}`)).toBeTruthy();
    expect(control(editor).matches(`.${EMPTY_AFFORDANCE_CLASS}`)).toBe(true);
  });

  it('the label no longer carries pointer-events none, which would eat the click', () => {
    // The one rule that had to go, asserted on the stylesheet rather than
    // assumed from the diff.
    const declaration = stylesCss.slice(
      stylesCss.indexOf(`.tiptap pre .${LANGUAGE_LABEL_CLASS}`),
      stylesCss.indexOf('}', stylesCss.indexOf(`.tiptap pre .${LANGUAGE_LABEL_CLASS}`)),
    );

    expect(declaration).not.toContain('pointer-events');
    // And the one #236 showed does not have to go.
    expect(declaration).toContain('user-select: none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — the control opens, sets, cancels, clears
// ─────────────────────────────────────────────────────────────────────────────

describe('the control sets the language of the block it was opened from (#238)', () => {
  it('clicking the label opens a field holding the language it has now', () => {
    const editor = open('```python\nx\n```');
    click(control(editor));

    expect(activeLanguagePopover()).not.toBe(null);
    expect(field().value).toBe('python');
  });

  it('clicking the mark on a plain block opens an empty field', () => {
    const editor = open('```\nx\n```');
    click(control(editor));

    expect(field().value).toBe('');
  });

  it('Enter sets the language, and the label redraws with it', () => {
    const editor = open('```python\nx\n```');
    click(control(editor));
    typeInto(field(), 'c++');
    press(field(), 'Enter');

    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe('c++');
    expect(control(editor).textContent).toBe('c++');
    expect(activeLanguagePopover()).toBe(null);
  });

  it('Escape changes nothing', () => {
    const editor = open('```python\nx\n```');
    click(control(editor));
    typeInto(field(), 'ruby');
    press(field(), 'Escape');

    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe('python');
    expect(activeLanguagePopover()).toBe(null);
  });

  it('an empty field clears the language, and the block becomes a plain box', () => {
    const editor = open('```python\nx\n```');
    click(control(editor));
    typeInto(field(), '');
    press(field(), 'Enter');

    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe(null);
    expect(control(editor).classList.contains(EMPTY_AFFORDANCE_CLASS)).toBe(true);
  });

  it('a plain block can be given a language, which is the route that did not exist', () => {
    const editor = open('```\nx\n```');
    click(control(editor));
    typeInto(field(), 'ts');
    press(field(), 'Enter');

    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe('ts');
    expect(control(editor).textContent).toBe('ts');
  });

  it('the field holds focus while it is open, and the editor takes it back after', () => {
    const editor = open('```python\nx\n```');
    click(control(editor));

    expect(document.activeElement).toBe(field());

    press(field(), 'Escape');
    expect(document.querySelector(`.${LANGUAGE_POPOVER_CLASS}`)).toBe(null);
    expect(editor.editor.view.hasFocus()).toBe(true);
  });

  it('the second block is the one that changes when its own control is used', () => {
    const editor = open('```python\na\n```\n\n```js\nb\n```');
    const controls = Array.from(
      editor.editor.view.dom.querySelectorAll(`.${LANGUAGE_LABEL_CLASS}`),
    ) as HTMLElement[];
    click(controls[1]);
    typeInto(field(), 'go');
    press(field(), 'Enter');

    const languages: Array<string | null> = [];
    editor.editor.state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') languages.push(node.attrs.language as string | null);
      return true;
    });
    expect(languages).toEqual(['python', 'go']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — the refusal, which is an R-C2 guard
// ─────────────────────────────────────────────────────────────────────────────

describe('the field refuses what the file cannot carry (#238)', () => {
  it('the refusal is decided by the same pattern the input rule uses', () => {
    expect(refusalFor('python')).toBe(null);
    expect(refusalFor('c++')).toBe(null);
    expect(refusalFor('C')).toBe(null);
    expect(refusalFor('py3')).toBe(null);
    expect(refusalFor('')).toBe(null);
    expect(refusalFor('   ')).toBe(null);
    expect(refusalFor('  python  ')).toBe(null);
    expect(refusalFor('py`thon')).toBe(LANGUAGE_HAS_BACKTICK);
    expect(refusalFor('python extra')).toBe(LANGUAGE_HAS_SPACE);
  });

  it('a backtick is refused as it is typed, before Enter', () => {
    const editor = open('```python\nx\n```');
    click(control(editor));
    typeInto(field(), 'py`thon');

    expect(errorLine().hidden).toBe(false);
    expect(errorLine().textContent).toBe(LANGUAGE_HAS_BACKTICK);
  });

  it('Enter on a refused value writes nothing and leaves the field open', () => {
    // A backtick in the language writes a fence that reopens as a paragraph,
    // so this refusal is R-C2 rather than tidiness.
    const editor = open('```python\nx\n```');
    click(control(editor));
    typeInto(field(), 'py`thon');
    press(field(), 'Enter');

    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe('python');
    expect(activeLanguagePopover()).not.toBe(null);
  });

  it('correcting the value takes the complaint away', () => {
    const editor = open('```python\nx\n```');
    click(control(editor));
    typeInto(field(), 'python extra');
    expect(errorLine().textContent).toBe(LANGUAGE_HAS_SPACE);

    typeInto(field(), 'python');
    expect(errorLine().hidden).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 — one gesture, one undo step
// ─────────────────────────────────────────────────────────────────────────────

describe('a change made here is one entry in the undo stack (R-C16, #238)', () => {
  /**
   * The write, driven where it lives rather than through the click.
   *
   * Deliberate, and the reason is the reversals. `closeHistory` belongs to
   * `commitBlockLanguage`, not to the popover, so the row that pins it must
   * not also need the click handler — otherwise the reversal that drops the
   * click reddens this row too and contains the reversal that drops
   * `closeHistory`, which makes the pair prove nothing about either. Driven
   * end to end through the real click in sections 3 and 6.
   *
   * The argument is the **widget** position, which is where the decoration
   * sits: one inside the block, exactly what `getPos` hands the click handler.
   */
  function widgetPosOfFirstBlock(editor: EditorInstance): number {
    let found: number | null = null;
    editor.editor.state.doc.descendants((node, pos) => {
      if (found === null && node.type.name === 'codeBlock') found = pos + 1;
      return found === null;
    });
    if (found === null) throw new Error('the document holds no fenced block');
    return found;
  }

  function set(editor: EditorInstance, language: string | null): boolean {
    return commitBlockLanguage(editor.editor.view, widgetPosOfFirstBlock(editor), language);
  }

  it('one undo takes the language back, and only the language', () => {
    const editor = open('```python\nx\n```');
    // The model text of a fence carries its trailing newline (#236), so what
    // the block held is read here rather than spelled out.
    const before = editor.editor.state.doc.firstChild?.textContent;
    set(editor, 'c++');
    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe('c++');

    editor.editor.commands.undo();
    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe('python');
    expect(editor.editor.state.doc.firstChild?.textContent).toBe(before);
  });

  it('two changes in quick succession are two undo steps, not one', () => {
    // `closeHistory` is what makes this true: without it the history plugin
    // appends the second change to the first event, and one undo takes both.
    const editor = open('```python\nx\n```');
    set(editor, 'c++');
    set(editor, 'go');

    editor.editor.commands.undo();
    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe('c++');

    editor.editor.commands.undo();
    expect(editor.editor.state.doc.firstChild?.attrs.language).toBe('python');
  });

  it('a write that would change nothing is not a write, so it costs no step', () => {
    const editor = open('```python\nx\n```');

    expect(set(editor, 'python')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 — the control is chrome and reaches no file
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing of the control reaches the document (#238)', () => {
  it('the popover is outside the editable tree while it is open', () => {
    const editor = open('```python\nx\n```');
    click(control(editor));

    expect(popover().parentElement).toBe(document.body);
    expect(editor.editor.view.dom.contains(popover())).toBe(false);
  });

  it('what the editor saves is the fence, with the language it was given', () => {
    const editor = open('```\nx\n```');
    click(control(editor));
    typeInto(field(), 'c++');
    press(field(), 'Enter');

    expect(editor.getMarkdown().trim()).toBe('```c++\nx\n```');
  });

  it('a document whose language was cleared saves as a plain fence', () => {
    const editor = open('```python\nx\n```');
    click(control(editor));
    typeInto(field(), '');
    press(field(), 'Enter');

    expect(editor.getMarkdown().trim()).toBe('```\nx\n```');
  });

  it('every #237 spelling set through this route saves and reopens the same', () => {
    // The languages the input rule admits, set here instead of typed, so the
    // two routes are held to one answer.
    for (const language of ['Python', 'JS', 'C', 'c#', 'c++', 'objective-c', 'py3', 'html5']) {
      const editor = open('```\nx\n```');
      click(control(editor));
      typeInto(field(), language);
      press(field(), 'Enter');
      const saved = editor.getMarkdown().trim();
      editor.destroy();
      instance = null;
      document.body.innerHTML = '';

      expect(saved).toBe(`\`\`\`${language}\nx\n\`\`\``);

      const reopened = open(saved);
      expect(reopened.getMarkdown().trim()).toBe(saved);
      reopened.destroy();
      instance = null;
      document.body.innerHTML = '';
    }
  });
});
