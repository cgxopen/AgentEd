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
