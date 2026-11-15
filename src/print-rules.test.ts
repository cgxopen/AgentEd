/**
 * The print rules of #725, read out of the shipped stylesheet and run against
 * the page the application renders: the shell of `index.html` and a document
 * in the real editor. happy-dom performs no layout and no printing, so what
 * these rows establish is which rule reaches which element with what; how the
 * page looks on paper is verified on the pull request, by the PDFs of each
 * platform and the manual pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import shippedPage from '../index.html?raw';
import { createEditor, type EditorInstance } from './editor/setup';
import stylesCss from './styles.css?raw';
import { reaches, type StyleRule, stylesheetRules } from './test-support/stylesheet-rules';

const PRINT = '@media print';
const rules = stylesheetRules(stylesCss);
const printRules = rules.filter((rule) => rule.conditions.includes(PRINT));
const screenRules = rules.filter((rule) => !rule.conditions.includes(PRINT));

/** The values a property takes in the print rules that reach the element. */
function printValues(target: Element, property: string): string[] {
  return printRules
    .filter((rule) => reaches(rule.selector, target) && rule.declarations.has(property))
    .map((rule) =>
      (rule.declarations.get(property) as string).replace(/\s*!important$/, '').trim(),
    );
}

function screenValues(
  target: Element,
  property: string,
  all: readonly StyleRule[] = screenRules,
): string[] {
  return all
    .filter((rule) => reaches(rule.selector, target) && rule.declarations.has(property))
    .map((rule) => rule.declarations.get(property) as string);
}

function element(selector: string): Element {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`the rendered page has no ${selector}`);
  return found;
}

const FIXTURE = [
  '# Print fixture',
  '',
  'A paragraph.',
  '',
  '## A table',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```text',
  'line 1',
  '```',
  '',
  '- [x] done',
  '- [ ] open',
  '',
  '### Third',
  '',
  'The end.',
].join('\n');

let instance: EditorInstance;

beforeAll(() => {
  // The page from #app up to the module script that follows it, which the
  // test does not load.
  const open = shippedPage.indexOf('<div id="app"');
  const close = shippedPage.indexOf('<script', open);
  if (open < 0 || close < 0) throw new Error('index.html no longer has #app before its script');
  document.body.innerHTML = shippedPage.slice(open, close);
  instance = createEditor(element('#editor') as HTMLElement);
  instance.setMarkdown(FIXTURE);
});

afterAll(() => {
  instance.destroy();
  document.body.innerHTML = '';
});

describe('the print rules (#725)', () => {
  it('the stylesheet holds a print block', () => {
    expect(printRules.length).toBeGreaterThan(0);
  });

  it('every container of the document that holds it in a fixed window gives that up on paper', () => {
    // The ancestors of the editor content up to <html>, and those of them a
    // screen rule gives a height or an overflow of their own.
    const held: Element[] = [];
    for (let node = element('.ProseMirror').parentElement; node; node = node.parentElement) {
      const height = screenValues(node, 'height');
      const overflow = [...screenValues(node, 'overflow'), ...screenValues(node, 'overflow-y')];
      if (height.length > 0 || overflow.some((v) => /hidden|auto|scroll/.test(v))) held.push(node);
    }
    expect(held.length).toBeGreaterThan(0);
    const notFreed = held
      .filter(
        (node) =>
          !printValues(node, 'overflow').includes('visible') ||
          !printValues(node, 'height').includes('auto'),
      )
      .map((node) => node.id || node.tagName);
    expect(notFreed).toEqual([]);
  });

  it('the chrome is not printed: the header, its menus and popovers, the files panel and the search panel', () => {
    const chrome = [
      '#menubar',
      '#menu-dropdown',
      '#overflow-popover',
      '#assets-popover',
      '#appearance-popover',
      '#sidebar',
      '#search-panel',
    ];
    const printed = chrome.filter(
      (selector) => !printValues(element(selector), 'display').includes('none'),
    );
    expect(printed).toEqual([]);
  });

  it('no button the editor renders inside the document is printed, the Copy and language buttons among them', () => {
    const buttons = Array.from(element('#editor').querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    const printed = buttons.filter((button) => !printValues(button, 'display').includes('none'));
    expect(printed.map((b) => b.className || b.textContent)).toEqual([]);
  });

  it('every element of the document is dark text on white, with no caret, whatever the palette', () => {
    const inDocument = Array.from(element('.ProseMirror').querySelectorAll('*'));
    expect(inDocument.length).toBeGreaterThan(10);
    const off = inDocument.filter(
      (el) =>
        !printValues(el, 'color').includes('#1a1a1a') ||
        !printValues(el, 'background').includes('transparent') ||
        !printValues(el, 'caret-color').includes('transparent'),
    );
    expect(off.map((el) => el.tagName)).toEqual([]);
    expect(printValues(document.body, 'background')).toContain('#fff');
  });

  it('the metadata field prints with no scroll bar or arrows', () => {
    const field = element('#frontmatter-input');
    expect(printValues(field, 'overflow')).toContain('hidden');
    expect(printValues(field, 'scrollbar-width')).toContain('none');
  });

  it('a code block wraps its lines on paper', () => {
    expect(printValues(element('.ProseMirror pre'), 'white-space')).toContain('pre-wrap');
  });

  it('every heading the editor renders is kept with what follows, where the engine honours it', () => {
    const headings = Array.from(element('.ProseMirror').querySelectorAll('h1, h2, h3'));
    expect(headings.length).toBe(3);
    const loose = headings.filter((h) => !printValues(h, 'break-after').includes('avoid'));
    expect(loose.map((h) => h.tagName)).toEqual([]);
  });
});
