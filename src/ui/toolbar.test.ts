import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
// Vite's `?raw` import — the shipped source and stylesheet as text, no Node
// APIs and no new dependency. Two properties of this file are not observable
// in a built value under a layout-free harness, so they are read where they
// are written (#265).
import stylesCss from '../styles.css?raw';
import { activeHeadingLevels, HEADING_LEVEL_OPTION_CLASS } from './heading-levels';
import { isActionEntry, setupToolbar, shippedButtons } from './toolbar';
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

/** The one control that opens a list, taken off the rendered toolbar. */
function headingTrigger(): HTMLButtonElement {
  const match = document.querySelector<HTMLButtonElement>(
    '#floating-toolbar button.heading-levels-trigger',
  );
  if (!match) throw new Error('the toolbar rendered no heading control');
  return match;
}

/**
 * The rule that gives the heading control a steady width, read out of the
 * stylesheet: its selector, so a test can run the shipped one against a
 * rendered element, and its declarations, so what the rule does is read rather
 * than repeated. Throws rather than returning an empty rule.
 */
function headingTriggerRule(): { selector: string; declarations: string } {
  const block = stylesCss.split('}').find((b) => b.includes('.heading-levels-trigger'));
  if (block === undefined) throw new Error('styles.css has no rule for the heading control');
  const brace = block.indexOf('{');
  const selector = block.slice(block.lastIndexOf('*/', brace) + 2, brace).trim();
  const declarations = block.slice(brace + 1).trim();
  if (selector.length === 0) throw new Error('could not read the heading-control selector');
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

describe('floating toolbar — one heading control for six levels (#267)', () => {
  /**
   * What this harness can see here, and what it cannot.
   *
   * It can see the table, the rendered buttons, the label, the list the
   * control opens and the document the list changes — none of that needs
   * layout. It cannot see **where** the list opens: `popoverPlacement` is
   * asserted on numbers in `popover-placement.test.ts`, the list is shown to
   * pass it the rectangles it reads in `heading-levels.test.ts` (#272), and
   * where that lands on a real screen is verified by hand.
   */

  it('ships one heading entry rather than three heading buttons', () => {
    // Read off the shipped table rather than restated, the #204 shape — and
    // the reason the control went into the array instead of beside it.
    const levels = shippedButtons.filter((b) => !isActionEntry(b));
    expect(levels).toHaveLength(1);
    expect(levels[0].title).toBe('Heading level');

    for (const gone of ['Heading 1', 'Heading 2', 'Heading 3']) {
      expect(shippedButtons.find((b) => b.title === gone)).toBeUndefined();
    }
  });

  it('the label follows the caret, in a heading and out of one', () => {
    // **The order is the whole of it.** The control is *constructed* reading
    // `H`, so checking body text first would be satisfied by a label the code
    // never had to produce — the cause recorded for the tenth decorative test,
    // which was also a toolbar test. So the heading comes first: `H2` is a
    // label only `labelFor` can put there. Body text second, from a control
    // that was reading `H2` rather than from a fresh one.
    const { editor } = mountEditorWithToolbar('## a heading\n\nordinary text');

    select(editor, 'a heading');
    expect(headingTrigger().textContent).toBe('H2');

    select(editor, 'ordinary text');
    expect(headingTrigger().textContent).toBe('H');
  });

  it('the control opens the list, and a row sets that level on the document', () => {
    // Driven through the real button rather than by calling the module: what
    // is asserted is the wiring, not the popover on its own.
    const { editor } = mountEditorWithToolbar('plain paragraph');
    select(editor, 'plain paragraph');

    headingTrigger().dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    const rows = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`.${HEADING_LEVEL_OPTION_CLASS}`),
    );
    expect(rows).toHaveLength(7);

    const five = rows.find((r) => r.textContent === 'Heading 5');
    if (!five) throw new Error('the list offers no Heading 5');
    five.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(editor.editor.isActive('heading', { level: 5 })).toBe(true);
    expect(editor.getMarkdown().trim()).toBe('##### plain paragraph');
  });

  it('choosing the level a heading already has leaves it that heading', () => {
    // `setHeading` rather than `toggleHeading`. A toggle would answer a
    // deliberate choice of Heading 3 by turning the heading into a paragraph.
    const { editor } = mountEditorWithToolbar('### already three');
    select(editor, 'already three');

    headingTrigger().dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    const three = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`.${HEADING_LEVEL_OPTION_CLASS}`),
    ).find((r) => r.textContent === 'Heading 3');
    if (!three) throw new Error('the list offers no Heading 3');
    three.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(editor.editor.isActive('heading', { level: 3 })).toBe(true);
    expect(editor.getMarkdown().trim()).toBe('### already three');
  });

  it('Body text takes a heading back to a paragraph', () => {
    const { editor } = mountEditorWithToolbar('#### fourth level');
    select(editor, 'fourth level');

    headingTrigger().dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    const body = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`.${HEADING_LEVEL_OPTION_CLASS}`),
    ).find((r) => r.textContent === 'Body text');
    if (!body) throw new Error('the list offers no Body text');
    body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(editor.editor.isActive('heading')).toBe(false);
    expect(editor.getMarkdown().trim()).toBe('fourth level');
  });

  it('a selection that moves ends the list', () => {
    // The route the list cannot see for itself: a keystroke moves the caret
    // while it is open, and the toolbar may hide under it.
    const { editor } = mountEditorWithToolbar('one\n\ntwo');
    select(editor, 'one');
    headingTrigger().dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    expect(activeHeadingLevels()).not.toBeNull();

    select(editor, 'two');

    expect(activeHeadingLevels()).toBeNull();
  });

  it('the width rule read out of styles.css reaches the control the toolbar rendered', () => {
    // The join, in the shape #263, #269 and #270 use: the selector and the
    // declaration come out of the stylesheet rather than being restated, and
    // both are run against the element `setupToolbar` actually built.
    //
    // `min-width` is why a label that follows the caret does not move the
    // toolbar. It cannot be observed here — happy-dom lays nothing out — so
    // what is asserted is that the rule exists and that it reaches this one
    // button and no other.
    const { selector, declarations } = headingTriggerRule();
    expect(declarations).toContain('min-width');

    mountEditorWithToolbar('the docs');
    const matched = Array.from(document.querySelectorAll(selector));

    expect(matched).toHaveLength(1);
    expect(matched[0]).toBe(headingTrigger());
  });
});
