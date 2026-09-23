import { describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import {
  FOOTNOTE_REFERENCE_CLASS,
  footnoteHoverDecorations,
  footnoteHoverKey,
} from './footnote-hover';
import { createEditor, type EditorInstance } from './setup';

/**
 * Issue #409 — a reference shows its note under the pointer.
 *
 * **Said first: the tooltip itself is not observable here.** happy-dom draws
 * no tooltip and the pointer does not exist, so what these rows hold is the
 * two halves that are readable — the decorations the plugin builds over the
 * document the editor actually parsed, and the cursor rule read out of the
 * shipped stylesheet and run against the class those decorations carry.
 * Either half alone asserts nothing. **Whether the note appears under the
 * pointer is verified in the owner pass on the artifact**, step 4.
 */

let editor: EditorInstance | null = null;

function open(markdown: string): EditorInstance {
  editor?.destroy?.();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  instance.setMarkdown(markdown);
  editor = instance;
  return instance;
}

/** Every decoration the plugin holds, as `{ text, title }`. */
function decorated(instance: EditorInstance): Array<{ text: string; title: string }> {
  const set = footnoteHoverKey.getState(instance.editor.state);
  if (set === undefined) throw new Error('the footnote hover plugin is not registered');
  const { doc } = instance.editor.state;
  return set.find().map((decoration) => ({
    text: doc.textBetween(decoration.from, decoration.to),
    // `type.attrs` is where an inline decoration keeps what it will render.
    title: String(
      (decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs.title,
    ),
  }));
}

describe('a reference carries the note its definition holds (#409)', () => {
  it('decorates a reference the document defines', () => {
    const instance = open('Text.[^a] more.\n\n[^a]: the note');

    expect(decorated(instance)).toEqual([{ text: '[^a]', title: 'the note' }]);
  });

  it('decorates every reference to the same definition', () => {
    const instance = open('One.[^a] Two.[^a]\n\n[^a]: the note');

    expect(decorated(instance).map((entry) => entry.text)).toEqual(['[^a]', '[^a]']);
  });

  it('leaves a reference with no definition alone', () => {
    // One of the four shapes R-C17 preserves on purpose: GitHub draws it as
    // literal text, and there is no note to show.
    const instance = open('Text.[^missing] more.\n\n[^a]: the note');

    expect(decorated(instance)).toEqual([]);
  });

  it('leaves a definition with an empty body alone', () => {
    const instance = open('Text.[^a]\n\n[^a]:');

    expect(decorated(instance)).toEqual([]);
  });

  it('does not decorate the definition line itself', () => {
    // The `[^a]:` opening a definition is not a reference to anything, and the
    // definition already shows its own text.
    const instance = open('Text.[^a]\n\n[^a]: the note');

    expect(decorated(instance)).toHaveLength(1);
  });

  it('leaves a reference inside a fenced block alone', () => {
    const instance = open('```\n[^a] in a code sample\n```\n\n[^a]: the note');

    expect(decorated(instance)).toEqual([]);
  });

  it('leaves a reference inside a code span alone', () => {
    const instance = open('Text `[^a]` shown as code.\n\n[^a]: the note');

    expect(decorated(instance)).toEqual([]);
  });

  it('joins the continuation lines of a definition into one note', () => {
    const instance = open('Text.[^a]\n\n[^a]: first line\n    second line');

    expect(decorated(instance)).toEqual([{ text: '[^a]', title: 'first linesecond line' }]);
  });

  it('reaches a reference in a list item and in a table cell', () => {
    const instance = open('- Item.[^a]\n\n| head |\n| --- |\n| cell.[^a] |\n\n[^a]: the note');

    expect(decorated(instance)).toHaveLength(2);
  });
});

describe('the walk is bounded and rides only a change of the document (#409)', () => {
  it('cuts the note off rather than putting a document in a tooltip', () => {
    const long = 'x'.repeat(600);
    const instance = open(`Text.[^a]\n\n[^a]: ${long}`);
    const [entry] = decorated(instance);

    expect(entry.title.length).toBe(401);
    expect(entry.title.endsWith('…')).toBe(true);
  });

  it('is rebuilt when the document changes', () => {
    const instance = open('Text.[^a] more.\n\n[^a]: the note');
    const before = footnoteHoverKey.getState(instance.editor.state);

    instance.editor.commands.insertContentAt(1, 'A ');

    expect(footnoteHoverKey.getState(instance.editor.state)).not.toBe(before);
  });

  /**
   * The reason this is held in plugin state rather than in `props.decorations`,
   * which is the shorter shape and the one #215 measured: a caret move cannot
   * change what the walk answers, so it should not pay for one.
   */
  it('is the same set after a selection change, so no walk is paid for a caret move', () => {
    const instance = open('Text.[^a] more.\n\n[^a]: the note');
    const before = footnoteHoverKey.getState(instance.editor.state);

    instance.editor.commands.setTextSelection({ from: 2, to: 4 });

    expect(footnoteHoverKey.getState(instance.editor.state)).toBe(before);
  });

  it('builds the same answer from the document alone, whoever asks', () => {
    const instance = open('Text.[^a]\n\n[^a]: the note');

    expect(footnoteHoverDecorations(instance.editor.state.doc).find()).toHaveLength(1);
  });
});

describe('the cue the pointer gets, joined at the element (#409)', () => {
  const rules = stylesheetRules(stylesCss);

  /**
   * **Both halves, against each other.** The rule is read out of the shipped
   * stylesheet rather than restated here, and it is run against the element
   * the editor actually rendered — a `span` the view wrote from the
   * decoration, which is where the note is carried too. Either half on its
   * own would pass while the other had moved.
   */
  it('the rendered reference is reached by the cursor rule the stylesheet ships', () => {
    const instance = open('Text.[^a] more.\n\n[^a]: the note');
    const rendered = instance.editor.view.dom.querySelector(`.${FOOTNOTE_REFERENCE_CLASS}`);
    if (rendered === null) throw new Error('the view rendered no decorated reference');

    expect(rendered.textContent).toBe('[^a]');
    expect(rendered.getAttribute('title')).toBe('the note');
    expect(valuesReaching(rules, rendered, 'cursor')).toContain('help');
  });

  it('and nothing else in the editor is given that cursor', () => {
    const instance = open('Plain text with no footnote in it.\n');
    const paragraph = instance.editor.view.dom.querySelector('p');
    if (paragraph === null) throw new Error('the view rendered no paragraph');

    expect(valuesReaching(rules, paragraph, 'cursor')).toEqual([]);
  });

  it('nothing it writes reaches the file', () => {
    // A decoration exists in the view and nowhere in the document model, so
    // the bytes are the file's own — the argument this module rests on, made
    // a row rather than a sentence.
    const source = 'Text.[^a] more.\n\n[^a]: the note';
    const instance = open(source);

    expect(instance.getMarkdown()).toBe(source);
    expect(instance.editor.getHTML()).not.toContain(FOOTNOTE_REFERENCE_CLASS);
  });
});
