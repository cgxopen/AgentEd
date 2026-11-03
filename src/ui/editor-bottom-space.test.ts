/**
 * The space under the last block of a document (#685).
 *
 * The space itself is layout, which happy-dom does not compute: it was
 * measured in Chromium, 0 px under the last block before and 48 px after, and
 * it is verified by the owner pass. What is asserted here are the two halves
 * this harness can see, joined: the rules are read out of `src/styles.css`,
 * and their selectors are run against the scroll container of the shipped
 * page with the editor mounted in it, so the element is the one the document
 * root actually sits in. A declaration on a selector that reached another
 * element, or a container the rule no longer reaches, would each pass alone.
 */
import { afterEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import stylesCss from '../styles.css?raw';
import { stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';

const atEveryWidth = stylesheetRules(stylesCss).filter((rule) => rule.conditions.length === 0);

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

/** The body of the shipped page, without its module script, with the editor mounted where `main.ts` mounts it. */
function mountedEditor(): { container: Element; root: Element } {
  const body = shippedPage.slice(
    shippedPage.indexOf('<body>') + '<body>'.length,
    shippedPage.indexOf('<script'),
  );
  document.body.innerHTML = body;
  const container = document.getElementById('editor');
  if (!container) throw new Error('the shipped page has no #editor');
  instance = createEditor(container);
  return { container, root: instance.editor.view.dom };
}

/** The value the last rule reaching `target` gives `property`, in sheet order. */
function last(target: Element, property: string): string | undefined {
  return valuesReaching(atEveryWidth, target, property).at(-1);
}

describe('the document is not stretched to the height of its scroll container (#685)', () => {
  it('the document root sits directly in the scroll container', () => {
    const { container, root } = mountedEditor();
    expect(root.parentElement).toBe(container);
    expect(last(container, 'overflow-y')).toBe('auto');
  });

  it('the scroll container is a flex row that aligns its child to the start', () => {
    // A flex row stretches its child to its own height unless told otherwise,
    // and a stretched child lets a long document run out of its box, past the
    // bottom padding. `normal` behaves as `stretch` for a flex item.
    const { container, root } = mountedEditor();
    expect(last(container, 'display')).toBe('flex');
    expect(last(container, 'align-items')).toBe('flex-start');
    const self = last(root, 'align-self');
    expect(self === undefined || self === 'auto', `align-self of the document root: ${self}`).toBe(
      true,
    );
  });

  it('keeps a bottom padding to show under the last block', () => {
    const { container } = mountedEditor();
    const padding = (last(container, 'padding') ?? '').split(/\s+/);
    const bottom = padding.length >= 3 ? padding[2] : padding[0];
    expect(Number.parseFloat(bottom ?? '0')).toBeGreaterThan(0);
  });
});
