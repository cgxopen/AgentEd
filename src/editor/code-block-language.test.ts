/**
 * A fenced block shows the language it was written with (R-C15, #195).
 *
 * Every assertion below runs the ordinary open path — `createEditor` +
 * `setMarkdown` — and reads the editor's own rendered DOM, so a stub of the
 * decoration cannot produce the evidence: the label has to have been built by
 * the plugin, off an attribute the real parse put there. That is the #146
 * lesson.
 *
 * The class is imported rather than spelled out here, so a rename turns this
 * file red instead of leaving it passing against a selector nothing uses.
 */
import { afterEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { LANGUAGE_LABEL_CLASS } from './code-block-language';
import { htmlToMarkdown } from './markdown/serialize';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

function open(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** Every label the editor is drawing, in document order. */
function labels(editor: EditorInstance): string[] {
  return Array.from(editor.editor.view.dom.querySelectorAll(`.${LANGUAGE_LABEL_CLASS}`)).map(
    (element) => element.textContent ?? '',
  );
}

/** Open, read the labels, close. For the cases that check several documents. */
function labelsFor(markdown: string): string[] {
  const editor = open(markdown);
  const found = labels(editor);
  editor.destroy();
  instance = null;
  return found;
}

/**
 * Feed text the way a keypress does, so the markdown input rules actually run.
 * `insertContent` does not go through them, so a test written with it would
 * assert nothing about the route a user takes.
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

function openAndSave(markdown: string): string {
  const editor = open(markdown);
  const saved = editor.getMarkdown().trim();
  editor.destroy();
  instance = null;
  return saved;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 and 2 — the two halves, in one file, driven the same way
// ─────────────────────────────────────────────────────────────────────────────

describe('a fence with a language shows it, and one without shows nothing', () => {
  it('pins the label on literal bytes for a known input', () => {
    // Written out rather than derived: an expected value the unit under test
    // computes asserts nothing (#173). `python` is the string the file spelled
    // and it is the string on screen, character for character.
    const editor = open('```python\nx = 1\n```');
    expect(labels(editor)).toEqual(['python']);
  });

  it('shows no label for a fence with no info string', () => {
    const editor = open('```\nplain text\n```');
    expect(labels(editor)).toEqual([]);
  });

  it('shows one label and not two when both fences are in the same document', () => {
    // The halves have to hold together rather than one at a time: a rule that
    // drew on every fence would pass the first test above and fail here.
    const editor = open('```python\nx = 1\n```\n\n```\nplain\n```\n\n```sh\nls\n```');
    expect(labels(editor)).toEqual(['python', 'sh']);
  });

  it('carries the language exactly as the file spelled it', () => {
    // Two info strings that a naive class-name reading mangles, both measured
    // through the pipeline: the hyphen and the two plus signs survive.
    expect(labelsFor('```objective-c\nid x;\n```')).toEqual(['objective-c']);
    expect(labelsFor('```c++\nint x;\n```')).toEqual(['c++']);
  });

  it('shows the label wherever a fence can sit', () => {
    expect(labelsFor('- ```ts\n  const x = 1;\n  ```')).toEqual(['ts']);
    expect(labelsFor('> ```sh\n> ls\n> ```')).toEqual(['sh']);
    expect(labelsFor('```js\n```')).toEqual(['js']);
  });

  it('shows the label on a fence typed with the input rule and a language', () => {
    // The route a user actually takes, and the one the toolbar does not offer:
    // there is no code-block button, so three backticks and a language is how a
    // fence gets made. The label has to appear on it as it does on an opened
    // one, which `setCodeBlock` below cannot show because it sets no language.
    const editor = open('');
    editor.editor.commands.focus();
    typeText(editor, '```python ');
    typeText(editor, 'x = 1');

    expect(labels(editor)).toEqual(['python']);
    expect(editor.getMarkdown().trim()).toBe('```python\nx = 1\n```');
  });

  it('shows no label on a fence typed with the input rule and no language', () => {
    const editor = open('');
    editor.editor.commands.focus();
    typeText(editor, '``` ');
    typeText(editor, 'x = 1');

    expect(labels(editor)).toEqual([]);
    expect(editor.getMarkdown().trim()).toBe('```\nx = 1\n```');
  });

  it('shows no label on a fence created in the editor', () => {
    // A fence made with the toolbar command has no info string, so R-C15's
    // negative half applies to it exactly as it does to one opened from a file.
    const editor = open('');
    editor.editor.commands.setCodeBlock();
    editor.editor.commands.insertContent('made here');

    expect(labels(editor)).toEqual([]);
    expect(editor.getMarkdown().trim()).toBe('```\nmade here\n```');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The label survives what a user does to the block
// ─────────────────────────────────────────────────────────────────────────────

describe('the label reads an attribute editing does not drop', () => {
  it('survives typing inside the block', () => {
    const editor = open('```python\nx = 1\n```');
    editor.editor.commands.focus('end');
    editor.editor.commands.insertContent('y = 2');

    expect(labels(editor)).toEqual(['python']);
    expect(editor.getMarkdown().trim()).toBe('```python\nx = 1\ny = 2\n```');
  });

  it('survives a copy-paste of the whole block, on both copies', () => {
    const editor = open('```python\nx = 1\n```');
    editor.editor.commands.selectAll();
    const slice = editor.editor.state.selection.content();
    editor.editor.commands.focus('end');
    editor.editor.view.dispatch(editor.editor.state.tr.replaceSelection(slice));

    expect(labels(editor)).toEqual(['python', 'python']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 and 6 — the file, and the serializer
// ─────────────────────────────────────────────────────────────────────────────

describe('the label is chrome and reaches no file', () => {
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

  it('is drawing five labels on that document while doing so', () => {
    // The floor under the test above: byte-identical would also be true of a
    // build that drew nothing at all, which is the half this pins.
    const editor = open(DOCUMENT);
    expect(labels(editor)).toEqual(['python', 'ts', 'sh', 'js']);
  });

  it('never reaches the serialized markdown, asserted on the serializer', () => {
    // Not on the DOM: the question is what `htmlToMarkdown` is handed and what
    // it writes. The editor's own HTML carries the widget, so this is the
    // assertion that the widget cannot travel through it.
    const editor = open('```python\nx = 1\n```');
    const editorHtml = editor.editor.getHTML();
    const written = htmlToMarkdown(editorHtml);

    expect(written).not.toContain(LANGUAGE_LABEL_CLASS);
    expect(written.trim()).toBe('```python\nx = 1\n```');
  });

  it('is absent from getHTML, because a decoration is not in the document', () => {
    // The structural reason criterion 6 holds rather than a test of it: the
    // serializer is handed the model, and the model has never heard of the
    // label. `getHTML` renders the model.
    const editor = open('```python\nx = 1\n```');
    expect(editor.editor.getHTML()).not.toContain(LANGUAGE_LABEL_CLASS);
    expect(editor.editor.view.dom.innerHTML).toContain(LANGUAGE_LABEL_CLASS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 — everything it reaches, and everything that should reach it
// ─────────────────────────────────────────────────────────────────────────────

describe('the label reaches every fence with a language and no fence without', () => {
  const MIXED = '```python\nx\n```\n\n```\nplain\n```\n\n```sh\nls\n```\n\n```\nmore plain\n```';

  it('everything the class reaches sits inside a fence that has a language', () => {
    const editor = open(MIXED);
    const found = Array.from(editor.editor.view.dom.querySelectorAll(`.${LANGUAGE_LABEL_CLASS}`));

    expect(found.length).toBeGreaterThan(0);
    for (const element of found) {
      const code = element.closest('pre')?.querySelector('code');
      expect(code?.className).toMatch(/^language-/);
      expect(code?.className).toContain(element.textContent ?? '');
    }
  });

  it('it reaches every fence that has one, and no fence that has not', () => {
    const editor = open(MIXED);
    const root = editor.editor.view.dom;
    const withLanguage = Array.from(root.querySelectorAll('pre')).filter((pre) =>
      pre.querySelector('code')?.className.startsWith('language-'),
    );
    const withoutLanguage = Array.from(root.querySelectorAll('pre')).filter(
      (pre) => !pre.querySelector('code')?.className.startsWith('language-'),
    );

    expect(withLanguage.length).toBe(2);
    expect(withoutLanguage.length).toBe(2);
    for (const pre of withLanguage) {
      expect(pre.querySelectorAll(`.${LANGUAGE_LABEL_CLASS}`).length).toBe(1);
    }
    for (const pre of withoutLanguage) {
      expect(pre.querySelectorAll(`.${LANGUAGE_LABEL_CLASS}`).length).toBe(0);
    }
  });

  it('the stylesheet carries a rule for the class the plugin writes', () => {
    // Read from `styles.css` rather than repeated, the `ci.test.ts` shape that
    // #164 and #198 both used. Without this the label would be in the DOM and
    // invisible, which no DOM assertion above could tell apart from working.
    const rule = stylesCss.split('}').find((block) => block.includes(LANGUAGE_LABEL_CLASS));
    expect(rule).toBeDefined();
    expect(rule).toContain('position: absolute');

    // And the containing block it is positioned against, which had to be added
    // for it: an absolutely positioned child of a `pre` that declares no
    // position would be laid out against the page.
    const preRule = stylesCss.split('}').find((block) => block.includes('.tiptap pre {'));
    expect(preRule).toContain('position: relative');
  });
});
