import { NodeSelection } from '@tiptap/pm/state';
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
  onImageDescription = vi.fn(),
): {
  editor: EditorInstance;
  onLink: ReturnType<typeof vi.fn>;
  onImageDescription: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  setupToolbar(instance.editor, { onLink, onImageDescription });
  return { editor: instance, onLink, onImageDescription };
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

describe('the bar is not offered for a whole-document selection (#336)', () => {
  /**
   * **What these rows can and cannot see.** The decision to hide is a branch in
   * `positionToolbar` reading the selection, and a branch is observable. Where
   * the bar would have landed is not: happy-dom lays nothing out. That the bar
   * was 40.0 px below the window before this — the reason the branch exists —
   * was measured in a browser and is recorded in `toolbar-placement.ts`.
   */
  const hidden = () =>
    (document.getElementById('floating-toolbar') as HTMLElement).classList.contains('hidden');

  /** The widest text selection the document allows, which is what a drag leaves. */
  function selectEveryWord(editor: EditorInstance): void {
    let first = 0;
    let last = 0;
    editor.editor.state.doc.descendants((node, pos) => {
      if (node.isText) {
        if (first === 0) first = pos;
        last = pos + node.nodeSize;
      }
    });
    editor.editor.commands.setTextSelection({ from: first, to: last });
  }

  it('shows the bar for a selection of part of the document', () => {
    const { editor } = mountEditorWithToolbar('One two three.\n\nFour five six.');
    editor.editor.commands.setTextSelection({ from: 1, to: 8 });
    expect(hidden()).toBe(false);
  });

  it('hides it for the selection Ctrl+A and the Select All entry produce', () => {
    const { editor } = mountEditorWithToolbar('One two three.\n\nFour five six.');
    editor.editor.commands.setTextSelection({ from: 1, to: 8 });
    expect(hidden()).toBe(false);
    editor.editor.commands.selectAll();
    expect(hidden()).toBe(true);
  });

  it('keeps it for a drag across every word, which is the owner choice', () => {
    // The row that tells the chosen key from the wider one. A selection over
    // all the text is a `TextSelection`, and the owner decided on 2026-09-16
    // that it keeps its bar — the band is what makes that bar reachable.
    // Measured: such a selection is 1..34 on a document of three paragraphs and
    // 4..48 on one opening with a table, never 0..size, because ProseMirror
    // clamps a text selection into the nearest textblock.
    const { editor } = mountEditorWithToolbar('One two three.\n\nFour five six.\n\nSeven eight.');
    selectEveryWord(editor);
    const { from, to } = editor.editor.state.selection;
    expect(from).toBeGreaterThan(0);
    expect(to).toBeLessThan(editor.editor.state.doc.content.size);
    expect(hidden()).toBe(false);
  });

  it('hides it on an empty document, where the press had raised it over nothing', () => {
    // The state in the owner capture of 2026-09-17: eleven controls above an
    // empty document, none of which changed anything when pressed. Measured
    // beside it and repaired by the same branch: the bar then stayed up through
    // an arrow press, because an empty document has nowhere for the caret to go
    // and so emits no selection update to take it down again.
    const { editor } = mountEditorWithToolbar('');
    editor.editor.commands.selectAll();
    expect(hidden()).toBe(true);
  });

  it('reads the selection type rather than the range, and says so in the source', () => {
    // Both would answer the same on every document — measured, since a text
    // selection can never reach position 0 or the document size. The type is
    // what is read, and a row pins which, so a later change of key is a change
    // somebody made on purpose.
    expect(positionToolbarSource()).toContain('instanceof AllSelection');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The control the bar offers for one kind of selection only (#291)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **What these rows can and cannot see.** Whether a control is drawn is an
 * attribute, and an attribute is observable. What the bar then *looks like* is
 * not: happy-dom lays nothing out, so the widths — 338.66 px on a text
 * selection against 372.66 px on an image — and the height of 32.00 px that
 * keeps `toolbarTop` where it was are browser measurements, recorded in the
 * pull request and judged by the manual pass.
 *
 * **`shippedButtons` still describes the whole bar**, which is what the owner
 * decision asked to be said plainly. It lists twelve entries and the bar
 * renders twelve buttons, one per entry, at every selection: the first row
 * below asserts exactly that. What the twelfth entry adds is a *rule about
 * when it is drawn*, carried on the entry itself as `appliesTo` — so the
 * exported table still says everything the bar can hold, and the second row
 * reads that table rather than naming the control.
 */
describe('the image description control is drawn only for an image (#291)', () => {
  /** The selection a click on an image leaves: the node itself. */
  function selectTheImage(editor: EditorInstance): void {
    let at = -1;
    editor.editor.state.doc.descendants((node, pos) => {
      if (at >= 0 || node.type.name !== 'image') return at < 0;
      at = pos;
      return false;
    });
    editor.editor.view.dispatch(
      editor.editor.state.tr.setSelection(NodeSelection.create(editor.editor.state.doc, at)),
    );
  }

  const WITH_IMAGE = 'One two three.\n\n![Holiday Photo.png](assets/Holiday-Photo.png)';

  it('renders one button per entry of shippedButtons, at every selection', () => {
    const { editor } = mountEditorWithToolbar(WITH_IMAGE);
    const all = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('#floating-toolbar button'));

    editor.editor.commands.setTextSelection({ from: 1, to: 8 });
    expect(all()).toHaveLength(shippedButtons.length);
    selectTheImage(editor);
    expect(all()).toHaveLength(shippedButtons.length);
    expect(all().map((b) => b.title)).toEqual(shippedButtons.map((entry) => entry.title));
  });

  /**
   * **The behaviour itself, named rather than derived.** The row below reads
   * each entry rule out of `shippedButtons`, which is what catches a rule
   * moved onto the wrong control — and, measured, it is **green when the rule
   * is deleted**, because an entry with no rule is drawn everywhere and the
   * row then expects exactly that. So the property this control exists for is
   * pinned here, by tooltip: absent on a text selection, drawn on an image.
   * Removing the rule reddens this row.
   */
  it('is absent for a text selection and drawn for an image', () => {
    const { editor } = mountEditorWithToolbar(WITH_IMAGE);
    const drawn = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('#floating-toolbar button'))
        .filter((b) => !b.hidden)
        .map((b) => b.title);

    editor.editor.commands.setTextSelection({ from: 1, to: 8 });
    expect(drawn()).not.toContain('Image description');
    expect(drawn()).toContain('Bold (Ctrl+B)');

    selectTheImage(editor);

    expect(drawn()).toContain('Image description');
    expect(drawn()).toHaveLength(shippedButtons.length);
  });

  /**
   * **The row over the wiring rather than over the rule**, and the difference
   * was measured rather than assumed. It reads each entry rule out of
   * `shippedButtons` and asserts the bar agrees with it, so what it catches is
   * a control drawn against what its own entry says: a pass that never ran, an
   * index that slipped, a rule consulted for the wrong button. **It cannot
   * catch a rule that is wrong**, because the rule is where it reads the
   * answer — deleting the rule and inverting it both left this row green,
   * which is what the row above exists for.
   */
  it('draws each entry exactly where its own rule says, for both selections', () => {
    const { editor } = mountEditorWithToolbar(WITH_IMAGE);
    const buttons = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('#floating-toolbar button'));

    for (const select of [
      () => editor.editor.commands.setTextSelection({ from: 1, to: 8 }),
      () => selectTheImage(editor),
    ]) {
      select();
      const rendered = buttons();
      shippedButtons.forEach((entry, i) => {
        const rule = isActionEntry(entry) ? entry.appliesTo : undefined;
        const expected = rule === undefined ? true : rule(editor.editor);
        expect(
          !rendered[i].hidden,
          `${entry.title} on ${editor.editor.state.selection.constructor.name}`,
        ).toBe(expected);
      });
    }
  });

  it('carries a drawn symbol and no words, with its name in the tooltip', () => {
    mountEditorWithToolbar(WITH_IMAGE);
    const button = toolbarButton('Image description');

    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
  });

  it('opens the dialog rather than acting on the editor itself', () => {
    const { editor, onImageDescription } = mountEditorWithToolbar(WITH_IMAGE);
    selectTheImage(editor);
    const before = editor.getMarkdown();

    toolbarButton('Image description').dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );

    expect(onImageDescription).toHaveBeenCalledTimes(1);
    expect(editor.getMarkdown()).toBe(before);
  });

  /**
   * The #265 order, applied to a second cause. A control that comes and goes
   * changes the width of the bar, and `positionToolbar` centres the bar on the
   * selection from a rectangle it takes **once** — so the visibility has to be
   * settled before that rectangle is taken. Read out of the source, the way
   * the reveal before the measurement is read above, because a layout-free
   * harness cannot see a bar centred against a width it no longer has.
   */
  it('settles which controls are drawn before it measures the bar', () => {
    const body = positionToolbarSource();
    const visibility = body.indexOf('updateVisibleControls()');
    const reveal = body.indexOf("toolbar.classList.remove('hidden')");
    const measure = body.indexOf('getBoundingClientRect()');

    expect(visibility, 'positionToolbar settles the visible controls').toBeGreaterThan(-1);
    expect(visibility).toBeLessThan(reveal);
    expect(reveal).toBeLessThan(measure);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Each end of the selection is asked for its own side (#350, the owner pass)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A soft line wrap, as `coordsAtPos` describes one.
 *
 * The real method returns a flat cursor rectangle, and at a wrap the position
 * sits between the end of one line and the start of the next. Asking for what
 * lies **after** it answers with the next line; asking for what lies
 * **before** it answers with this one. That is the whole of the defect and the
 * whole of the repair, so the stub answers exactly that and nothing else.
 *
 * **This is the half of the placement a layout-free harness can see.** Where
 * the bar then lands on a real screen is the manual pass, as everything else
 * in this family is; what is asserted here is which of the two answers the
 * code asks for.
 */
function wrapAt(
  editor: EditorInstance,
  end: number,
  coords: { endOfThisLine: number; startOfNextLine: number; selectionStart: number },
): { sides: Array<{ pos: number; side: number | undefined }> } {
  const sides: Array<{ pos: number; side: number | undefined }> = [];
  const flat = (x: number) => ({ left: x, right: x, top: 100, bottom: 120 });
  editor.editor.view.coordsAtPos = ((pos: number, side?: number) => {
    sides.push({ pos, side });
    if (pos !== end) return flat(coords.selectionStart);
    return flat(side !== undefined && side < 0 ? coords.endOfThisLine : coords.startOfNextLine);
  }) as typeof editor.editor.view.coordsAtPos;
  return { sides };
}

describe('the bar centres on the selection, not on two different lines (#350)', () => {
  it('asks for the start after the position and the end before it', () => {
    // The contract in one row: the selection begins where what follows it is
    // drawn, and ends where what precedes it is drawn. Both default to 1, which
    // is what put the end of a wrapped line at the start of the next one.
    const { editor } = mountEditorWithToolbar('alpha beta gamma delta');
    const { sides } = wrapAt(editor, 6, {
      selectionStart: 700,
      endOfThisLine: 760,
      startOfNextLine: 40,
    });

    editor.editor.commands.setTextSelection({ from: 1, to: 6 });

    expect(sides).toContainEqual({ pos: 1, side: 1 });
    expect(sides).toContainEqual({ pos: 6, side: -1 });
  });

  it('places the bar on the line the selection is drawn on', () => {
    // Driven through the stub above, which is the defect itself: with the
    // default side the end of this selection answers 40, the start of the line
    // below, and the centre falls at (700 + 40) / 2 = 370. With the side this
    // code now asks for it answers 760 and the centre falls at 730, over the
    // text. The figures are the shape of the one instrumented in Chromium,
    // where the end resolved to 152.0 against a selection drawn at 794 to 848.
    const { editor } = mountEditorWithToolbar('alpha beta gamma delta');
    wrapAt(editor, 6, { selectionStart: 700, endOfThisLine: 760, startOfNextLine: 40 });

    editor.editor.commands.setTextSelection({ from: 1, to: 6 });

    const bar = document.getElementById('floating-toolbar') as HTMLElement;
    const width = bar.getBoundingClientRect().width;
    const wrapped = Math.max(8, 370 - width / 2);
    const onTheLine = Math.max(8, 730 - width / 2);
    expect(bar.style.left).toBe(`${onTheLine}px`);
    expect(bar.style.left).not.toBe(`${wrapped}px`);
  });
});

/**
 * A selection as the engine paints it, which is what `paintedOnOneLine` reads.
 *
 * The rectangles are supplied rather than measured, because happy-dom paints
 * nothing; what the rows below assert is which of the two readings the code
 * centres on, not where the bar lands on a screen.
 */
function painted(editor: EditorInstance, rects: Array<[left: number, right: number, top: number]>) {
  const range = {
    commonAncestorContainer: editor.editor.view.dom,
    getClientRects: () =>
      rects.map(([left, right, top]) => ({
        left,
        right,
        top,
        width: right - left,
        bottom: top + 20,
      })),
  };
  const selection = {
    rangeCount: rects.length === 0 ? 0 : 1,
    isCollapsed: rects.length === 0,
    getRangeAt: () => range,
  };
  const original = document.getSelection;
  document.getSelection = (() => selection) as unknown as typeof document.getSelection;
  return () => {
    document.getSelection = original;
  };
}

describe('the bar is centred on what the engine painted, not on a resolved position (#350)', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('centres on the painted rectangles even where the engine answers the line below on both sides', () => {
    // **This is the state the owner met on Windows and the reason this reading
    // exists.** Asking for the side before the position repairs it in Chromium
    // and does not in WebView2, measured on `ea052b3`: the bar stayed in the
    // middle of the editor for the last word of a line. So the engine here is
    // driven as WebView2 behaves - answering the start of the line below
    // whichever side is asked for - and the placement still has to be right.
    //
    // A selection the engine painted on one line cannot have its ends on two,
    // so the drawing is taken over the resolved positions and no engine has to
    // agree about anything. Without this reading the centre would be
    // (700 + 40) / 2 = 370; with it, (700 + 760) / 2 = 730.
    const { editor } = mountEditorWithToolbar('alpha beta gamma delta');
    wrapAt(editor, 6, { selectionStart: 700, endOfThisLine: 40, startOfNextLine: 40 });
    restore = painted(editor, [[700, 760, 100]]);

    editor.editor.commands.setTextSelection({ from: 1, to: 6 });

    const bar = document.getElementById('floating-toolbar') as HTMLElement;
    const width = bar.getBoundingClientRect().width;
    expect(bar.style.left).toBe(`${Math.max(8, 730 - width / 2)}px`);
    expect(bar.style.left).not.toBe(`${Math.max(8, 370 - width / 2)}px`);
  });

  it('falls back to the resolved positions when the selection covers more than one line', () => {
    // Deliberately narrow: a selection the engine drew across two lines has no
    // single line to be centred on, so it is placed exactly where it always
    // was. Two rectangles with different tops, and the placement is the one the
    // resolved positions give.
    const { editor } = mountEditorWithToolbar('alpha beta gamma delta');
    wrapAt(editor, 6, { selectionStart: 700, endOfThisLine: 300, startOfNextLine: 300 });
    restore = painted(editor, [
      [700, 900, 100],
      [40, 300, 140],
    ]);

    editor.editor.commands.setTextSelection({ from: 1, to: 6 });

    const bar = document.getElementById('floating-toolbar') as HTMLElement;
    const width = bar.getBoundingClientRect().width;
    // (start.left 700 + end.right 300) / 2 = 500, the resolved reading.
    expect(bar.style.left).toBe(`${Math.max(8, 500 - width / 2)}px`);
  });

  it('falls back when nothing is painted at all, which is a selected image', () => {
    // A node selection paints no range, so the bar keeps the placement the
    // resolved positions give it - which for an image is the box itself.
    const { editor } = mountEditorWithToolbar('alpha beta gamma delta');
    wrapAt(editor, 6, { selectionStart: 700, endOfThisLine: 760, startOfNextLine: 40 });
    restore = painted(editor, []);

    editor.editor.commands.setTextSelection({ from: 1, to: 6 });

    const bar = document.getElementById('floating-toolbar') as HTMLElement;
    const width = bar.getBoundingClientRect().width;
    expect(bar.style.left).toBe(`${Math.max(8, 730 - width / 2)}px`);
  });
});
