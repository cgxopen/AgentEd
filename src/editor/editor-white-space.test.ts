import { GapCursor } from '@tiptap/pm/gapcursor';
import { afterEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { createEditor, type EditorInstance } from './setup';

/**
 * The editor draws white space as the document holds it (#603, owner decision
 * of 2026-10-17, option a).
 *
 * **What is drawn is not observable here**: happy-dom computes no layout, and
 * the CSP that refused the rules TipTap injects does not run in the harness.
 * So the two halves that are observable are asserted and joined: the rules are
 * read out of the stylesheet rather than restated, and run against the
 * elements the editor actually rendered. The drawing itself, and what two
 * typed spaces become, are verified in Chromium under the CSP of the app and
 * on Windows, from the artifact of the pull request.
 */

const rules = stylesheetRules(stylesCss);
let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

function rendered(markdown: string): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return host;
}

/** The white-space a rule of the stylesheet gives the element, the last one written. */
function whiteSpaceOf(element: Element): string | undefined {
  return valuesReaching(rules, element, 'white-space').at(-1);
}

describe('the editor draws white space as it is held (#603)', () => {
  it('the editable element is given break-spaces', () => {
    const editable = rendered('a `x  y` b').querySelector('.ProseMirror');
    expect(editable).not.toBeNull();
    expect(whiteSpaceOf(editable as Element)).toBe('break-spaces');
  });

  it('an atom the editor does not edit goes back to normal', () => {
    const atom = rendered('a <!-- note --> b').querySelector('[contenteditable="false"]');
    expect(atom).not.toBeNull();
    expect(whiteSpaceOf(atom as Element)).toBe('normal');
  });

  it('a code span takes the white space of the editor rather than a rule of its own', () => {
    const span = rendered('a `x  y` b').querySelector('code');
    expect(span).not.toBeNull();
    expect(whiteSpaceOf(span as Element)).toBeUndefined();
  });
});

/** The value of `property` the stylesheet gives the element, the last rule written. */
function ruleValue(element: Element, property: string): string | undefined {
  return valuesReaching(rules, element, property).at(-1);
}

/** The editor holding a gap cursor after the rule that closes the document. */
function withGapCursor(focused: boolean): HTMLElement {
  const host = rendered('Text before.\n\n---\n');
  const { view } = (instance as EditorInstance).editor;
  const end = view.state.doc.content.size;
  view.dispatch(view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(end))));
  if (focused) view.focus();
  return host;
}

describe('the rest of the rules TipTap injects (#614)', () => {
  it('the gap cursor is placed out of the flow and shown while the editor has focus', () => {
    const cursor = withGapCursor(true).querySelector('.ProseMirror-gapcursor');
    expect(cursor).not.toBeNull();
    expect(ruleValue(cursor as Element, 'position')).toBe('absolute');
    expect(ruleValue(cursor as Element, 'margin')).toBe('0');
    expect(ruleValue(cursor as Element, 'display')).toBe('block');
  });

  it('the gap cursor is hidden while the editor has no focus', () => {
    const cursor = withGapCursor(false).querySelector('.ProseMirror-gapcursor');
    expect(cursor).not.toBeNull();
    expect(ruleValue(cursor as Element, 'display')).toBe('none');
  });

  it('the gap cursor is drawn as a line in the colour of the caret', () => {
    const cursor = withGapCursor(true).querySelector('.ProseMirror-gapcursor') as Element;
    // A pseudo-element matches no element, so the rule is found by its selector
    // and its element half run against the cursor the editor rendered.
    const line = rules.filter(
      (rule) =>
        rule.selector.endsWith('::after') &&
        cursor.matches(rule.selector.slice(0, -'::after'.length)),
    );
    expect(line.map((rule) => rule.declarations.get('border-top'))).toEqual([
      '1px solid var(--accent)',
    ]);
    expect(line[0].declarations.get('content')).toBe('""');
    expect(line[0].declarations.get('width')).toBe('20px');
  });

  it('ligatures are switched off on the editable element', () => {
    const editable = rendered('office flow').querySelector('.ProseMirror') as Element;
    expect(ruleValue(editable, 'font-variant-ligatures')).toBe('none');
    expect(ruleValue(editable, 'font-feature-settings')).toBe('"liga" 0');
  });

  it('the rules measured as changing nothing are not written', () => {
    const editable = rendered('a\n\n---\n').querySelector('.ProseMirror') as Element;
    // Word wrap comes from the default stylesheet of Chromium, `position:
    // relative` moved nothing, and the separator image is 0 px either way.
    expect(ruleValue(editable, 'word-wrap')).toBeUndefined();
    expect(ruleValue(editable, 'overflow-wrap')).toBeUndefined();
    expect(ruleValue(editable, 'position')).toBeUndefined();
    expect(rules.some((rule) => rule.selector.includes('ProseMirror-separator'))).toBe(false);
  });
});
