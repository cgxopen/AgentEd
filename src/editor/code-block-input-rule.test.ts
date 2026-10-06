/**
 * The typed fence makes a block for every language CommonMark admits (#237).
 *
 * Every assertion below drives the **real input rules**, character by
 * character through `handleTextInput` and — for Enter — through
 * `handleKeyDown`, which is where TipTap registers the rule's newline
 * trigger. `insertContent` does not go through them, so a test written with
 * it would assert nothing about the route a user takes; the same helper and
 * the same reason as `code-block-language.test.ts`.
 *
 * The patterns are **imported rather than restated**, so a change to the rule
 * that this file does not expect turns it red instead of leaving it passing
 * against a regex nothing uses.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BACKTICK_FENCE_INPUT_REGEX, TILDE_FENCE_INPUT_REGEX } from './code-block-input-rules';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

function open(): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown('');
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

/**
 * Enter the way the key does. TipTap's input-rule plugin runs the rules from
 * `handleKeyDown` with the text `\n`, so `commands.enter()` — which never
 * reaches that prop — would measure a different route and report every
 * Enter case below as a paragraph.
 */
function pressEnter(editor: EditorInstance): void {
  const event = new KeyboardEvent('keydown', { key: 'Enter' });
  const handled = editor.editor.view.someProp('handleKeyDown', (handler) =>
    handler(editor.editor.view, event),
  );
  if (!handled) editor.editor.commands.enter();
}

interface Block {
  readonly kind: string;
  readonly language: string | null;
  readonly text: string;
  readonly saved: string;
}

/** Type `typed`, then finish it with a space or with Enter, and read the result. */
function fenceFrom(typed: string, ender: 'space' | 'enter'): Block {
  const editor = open();
  typeText(editor, typed);
  if (ender === 'space') typeText(editor, ' ');
  else pressEnter(editor);
  const first = editor.editor.state.doc.firstChild;
  const block: Block = {
    kind: first?.type.name ?? 'none',
    language: (first?.attrs.language as string | null | undefined) ?? null,
    text: first?.textContent ?? '',
    saved: editor.getMarkdown().trim(),
  };
  editor.destroy();
  instance = null;
  document.body.innerHTML = '';
  return block;
}

const ENDERS = ['space', 'enter'] as const;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the defect: the eight spellings the `a`-`z` group refused
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The eight from the issue's table. `python` and `yaml` are not here because
 * they never failed; they are the regression half below.
 */
const REFUSED_BEFORE = ['Python', 'JS', 'C', 'c#', 'c++', 'objective-c', 'py3', 'html5'] as const;

describe('a language outside a-z makes a block with that exact language (#237)', () => {
  for (const ender of ENDERS) {
    it.each(REFUSED_BEFORE)(`%s, finished with ${ender}`, (language) => {
      const block = fenceFrom(`\`\`\`${language}`, ender);

      expect(block.kind).toBe('codeBlock');
      expect(block.language).toBe(language);
    });

    it.each(REFUSED_BEFORE)(`%s is saved as that fence, finished with ${ender}`, (language) => {
      // The half the user sees in Notepad: a fence with that info string, and
      // no backslash anywhere. Before this change the same keystrokes saved
      // as an escaped paragraph — `\`\`\`Python` — which is what the issue
      // was filed about.
      const block = fenceFrom(`\`\`\`${language}`, ender);

      expect(block.saved).toBe(`\`\`\`${language}\n\`\`\``);
      expect(block.saved).not.toContain('\\');
    });
  }

  it.each(REFUSED_BEFORE)('the tilde twin admits %s too', (language) => {
    // The same group on the other marker. It is saved with backticks, because
    // turndown writes every fenced block that way — which is also why the
    // tilde group excludes a backtick that CommonMark would have allowed it.
    for (const ender of ENDERS) {
      const block = fenceFrom(`~~~${language}`, ender);

      expect(block.kind).toBe('codeBlock');
      expect(block.language).toBe(language);
      expect(block.saved).toBe(`\`\`\`${language}\n\`\`\``);
    }
  });

  it('the case the user typed is the case the file carries', () => {
    // No normalisation, deliberately: what this rule sets is what the file
    // will carry and what the #202 label will draw.
    expect(fenceFrom('```Python', 'enter').language).toBe('Python');
    expect(fenceFrom('```JS', 'enter').language).toBe('JS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the regression half
// ─────────────────────────────────────────────────────────────────────────────

describe('what already worked goes on working (#237)', () => {
  for (const ender of ENDERS) {
    it.each(['python', 'yaml', 'ts', 'js'])(
      `a lowercase language still makes a block: %s, finished with ${ender}`,
      (language) => {
        const block = fenceFrom(`\`\`\`${language}`, ender);

        expect(block.kind).toBe('codeBlock');
        expect(block.language).toBe(language);
      },
    );

    it(`three backticks alone still make a block with no language, finished with ${ender}`, () => {
      const block = fenceFrom('```', ender);

      expect(block.kind).toBe('codeBlock');
      expect(block.language).toBe(null);
    });

    it(`the tilde fence still works, finished with ${ender}`, () => {
      // What the tilde twin already did, kept apart from what it newly does:
      // the new spellings on this marker are in the section above, so a
      // change that narrows the group again reddens that section alone.
      expect(fenceFrom('~~~', ender)).toMatchObject({ kind: 'codeBlock', language: null });
      expect(fenceFrom('~~~python', ender)).toMatchObject({
        kind: 'codeBlock',
        language: 'python',
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — the two edges CommonMark draws
// ─────────────────────────────────────────────────────────────────────────────

describe('the rule stops where CommonMark stops (#237)', () => {
  for (const ender of ENDERS) {
    it(`a backtick inside the info string still makes no block, finished with ${ender}`, () => {
      // Not this rule being strict: ```` ```py`thon ```` opens no fence in any
      // CommonMark reader, so a block here would be written to a file that
      // comes back as a paragraph. It stays the paragraph it already is.
      const block = fenceFrom('```py`thon', ender);

      expect(block.kind).toBe('paragraph');
    });

    it(`the language stops at the first space, finished with ${ender}`, () => {
      // The first space is the character that fires the rule, so what follows
      // it is typed into the block rather than into its language. The
      // trailing space of the `space` ender lands in the block for the same
      // reason, which is why the text is compared trimmed.
      const block = fenceFrom('```python extra', ender);

      expect(block.kind).toBe('codeBlock');
      expect(block.language).toBe('python');
      expect(block.text.trim()).toBe('extra');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — the patterns themselves, read rather than restated
// ─────────────────────────────────────────────────────────────────────────────

describe('the two patterns are the same rule twice, one marker apart (#237)', () => {
  it('the tilde twin differs from the backtick one only in its marker', () => {
    expect(TILDE_FENCE_INPUT_REGEX.source).toBe(
      BACKTICK_FENCE_INPUT_REGEX.source.replaceAll('```', '~~~'),
    );
  });
});
