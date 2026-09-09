import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
// Vite's `?raw` import — the shipped source and stylesheet as text, no Node
// APIs and no new dependency. Two properties of this file are not observable
// in a built value under a layout-free harness, so they are read where they
// are written (#265).
import stylesCss from '../styles.css?raw';
import { setupToolbar } from './toolbar';
import toolbarSource from './toolbar.ts?raw';

let instance: EditorInstance | null = null;

function mountEditorWithToolbar(
  markdown: string,
  onLink = vi.fn(),
): {
  editor: EditorInstance;
  onLink: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  setupToolbar(instance.editor, { onLink });
  return { editor: instance, onLink };
}

function toolbarButton(title: string): HTMLButtonElement {
  const match = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#floating-toolbar button'),
  ).find((b) => b.title === title);
  if (!match) throw new Error(`no toolbar button titled "${title}"`);
  return match;
}

/**
 * The body of `positionToolbar`, sliced out of the shipped source so an
 * ordering can be read rather than restated. Throws if either boundary has
 * moved: a test that silently searched an empty string would pass on nothing,
 * which is the whole failure mode this file is careful about.
 */
function positionToolbarSource(): string {
  const from = toolbarSource.indexOf('function positionToolbar()');
  if (from < 0) throw new Error('toolbar.ts no longer declares positionToolbar');
  const to = toolbarSource.indexOf("editor.on('selectionUpdate'", from);
  if (to < 0) throw new Error('toolbar.ts no longer binds selectionUpdate after positionToolbar');
  return toolbarSource.slice(from, to);
}

/**
 * The `.floating-toolbar.hidden` rule, read out of the stylesheet: its
 * selector, so a test can run the shipped one against a rendered element, and
 * its declarations, so what the hidden state actually does is read rather than
 * repeated here. Throws rather than returning an empty rule.
 */
function hiddenToolbarRule(): { selector: string; declarations: string } {
  const block = stylesCss.split('}').find((b) => b.includes('.floating-toolbar.hidden'));
  if (block === undefined) throw new Error('styles.css has no rule for a hidden floating toolbar');
  const brace = block.indexOf('{');
  const selector = block.slice(block.lastIndexOf('*/', brace) + 2, brace).trim();
  const declarations = block.slice(brace + 1).trim();
  if (selector.length === 0) throw new Error('could not read the hidden-toolbar selector');
  return { selector, declarations };
}

function select(editorInstance: EditorInstance, text: string): void {
  let from = -1;
  editorInstance.editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) from = pos + node.text.indexOf(text);
  });
  if (from < 0) throw new Error(`text not found: ${text}`);
  editorInstance.editor.commands.setTextSelection({ from, to: from + text.length });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.getElementById('floating-toolbar')?.remove();
});

describe('floating toolbar — the link button (#25)', () => {
  it('ships alongside the formatting buttons', () => {
    mountEditorWithToolbar('the docs');
    expect(() => toolbarButton('Link (Ctrl+K)')).not.toThrow();
    expect(() => toolbarButton('Bold (Ctrl+B)')).not.toThrow();
  });

  it('opens the dialog rather than acting on the editor itself', () => {
    const { editor, onLink } = mountEditorWithToolbar('the docs');
    select(editor, 'the docs');

    toolbarButton('Link (Ctrl+K)').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );

    expect(onLink).toHaveBeenCalledTimes(1);
    // The button asks; the dialog decides. Nothing changes until it does.
    expect(editor.getMarkdown()).toBe('the docs');
  });

  it('marks itself active when the caret sits in a link', () => {
    const { editor } = mountEditorWithToolbar('[docs](https://example.com)');
    select(editor, 'docs');
    editor.editor.commands.focus();

    expect(toolbarButton('Link (Ctrl+K)').classList.contains('active')).toBe(true);
  });
});

describe('floating toolbar — it is revealed before it is measured (#265)', () => {
  /**
   * ── What this harness can and cannot see ──
   *
   * It cannot see the position. `positionToolbar` reads `coordsAtPos` and
   * `getBoundingClientRect`, and happy-dom performs no layout, so every box is
   * 0 by 0 whatever the code does. That is not a limitation to work around
   * here — it is the defect's own value. Instrumented on Chrome for Testing
   * 153, the toolbar answers **0 by 0 while hidden and 414.47 by 31.59 once
   * revealed**; under a layout-free engine the defective code and the repaired
   * one compute identical numbers, so any assertion about where the toolbar
   * landed would be asserting nothing.
   *
   * Nor can this harness drive the toolbar through a focus: a programmatic one
   * fires neither `selectionUpdate` nor `focus` here, and a test that leans on
   * it is satisfied by the `hidden` class the toolbar is *constructed* with.
   * That is the recorded cause of the tenth decorative test, and it was a
   * toolbar test. So the selection comes first below and the collapse second —
   * revealing it is what proves the code can produce the state at all, and
   * hiding it *again*, from a revealed toolbar, is the only order in which the
   * hidden state is something the code did rather than something it was born
   * with.
   *
   * The two halves below are what is left, and each says what it is worth.
   * The placement itself is verified by hand on Windows.
   */

  it('the reveal precedes the measurement, read out of the source', () => {
    // Weaker than checking a computed result, and it is what is available —
    // the shape `open-failure.test.ts` uses, and the one #263 added to pin
    // configure-before-extend for the same reason.
    //
    // It catches exactly one mistake: the two statements swapping back, which
    // is the mistake that was actually made and shipped. It cannot tell
    // whether the measured box is right, whether the arithmetic below it is
    // right, or whether anything is painted in between.
    //
    // Both indices are asserted present before they are compared, so a rename
    // or a removal fails here rather than passing on two absent statements.
    const body = positionToolbarSource();
    const revealAt = body.indexOf("classList.remove('hidden')");
    const measureAt = body.indexOf('getBoundingClientRect(');

    expect(revealAt).toBeGreaterThanOrEqual(0);
    expect(measureAt).toBeGreaterThanOrEqual(0);
    expect(revealAt).toBeLessThan(measureAt);
  });

  it('the hidden state read out of styles.css reaches the toolbar the editor rendered', () => {
    // The join, in the shape #263 used for its two heading rules: the selector
    // and the declaration come out of the stylesheet rather than being
    // restated here, and both are run against the element `setupToolbar`
    // actually built. Either half alone asserts nothing — a rule nothing
    // matches, or an element with no rule behind it.
    //
    // `display: none` is why the box measures zero, which is why the order
    // pinned above matters. It is read rather than assumed, so a stylesheet
    // that stopped spelling the hidden state this way turns this red and sends
    // the reader back to the ordering.
    const { selector, declarations } = hiddenToolbarRule();
    expect(declarations).toContain('display: none');

    const { editor } = mountEditorWithToolbar('the docs');
    const toolbar = document.getElementById('floating-toolbar');
    if (toolbar === null) throw new Error('setupToolbar rendered no toolbar');

    // Revealed first: the code has to produce this state, and the rule out of
    // the stylesheet then reaches nothing.
    select(editor, 'the docs');
    expect(editor.editor.state.selection.empty).toBe(false);
    expect(Array.from(document.querySelectorAll(selector))).not.toContain(toolbar);

    // Hidden again, from a toolbar that was visible: the rule reaches it.
    editor.editor.commands.setTextSelection(1);
    expect(editor.editor.state.selection.empty).toBe(true);
    expect(Array.from(document.querySelectorAll(selector))).toContain(toolbar);
  });
});
