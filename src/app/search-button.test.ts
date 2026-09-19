/**
 * Issue #312 — the header magnifier closes the panel it opened, and is lit
 * while the panel is open.
 *
 * **Two commands where there was one.** Before #312 the magnifier and `Ctrl+F`
 * both called `openFind`, so pointing each route at the other's handler
 * changed nothing and no row could tell. The button now calls `toggleFind` and
 * the chord keeps `openFind`, and the rows below are what tells them apart: the
 * button's second press closes, the chord's second press returns to the field.
 *
 * **What is covered here, and what is not.** The behaviour is fully observable
 * without layout — a click, `isOpen()`, `aria-expanded` — and is asserted over
 * the shipped markup, a real editor and the real manager. How the lit button
 * looks is not: the rules that draw it are read out of the stylesheet and run
 * against the element rendered here, which says which rule reaches it and with
 * what, and the shade itself, in seven palettes, is verified by hand on the
 * pull request artifact.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import stylesCss from '../styles.css?raw';
import { reaches, stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { overflowClone, wireSearchButton } from './header-wiring';
import { createSearchManager, type SearchManager } from './search-manager';

/** The fragment of the shipped page between two markers, both included. */
function shippedFragment(from: string, to: string): string {
  const open = shippedPage.indexOf(from);
  const close = shippedPage.indexOf(to, open);
  if (open < 0 || close < 0) throw new Error(`index.html no longer has ${from} … ${to}`);
  return shippedPage.slice(open, close + to.length);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped page has no #${id}`);
  return found;
}

// One manager for the whole file. `installKeyboardListeners` adds a document
// listener with no teardown, so a manager per test would leave every earlier
// one answering the same keystroke.
let instance: EditorInstance;
let manager: SearchManager;
const onOpen = vi.fn();

beforeAll(() => {
  document.body.innerHTML = [
    shippedFragment('<header id="menubar">', '</header>'),
    shippedFragment('<div id="search-panel"', '<details id="frontmatter-panel"').replace(
      /<details id="frontmatter-panel"$/,
      '',
    ),
    '<div id="editor-host"></div>',
  ].join('');
  instance = createEditor(element('editor-host'));
  instance.setMarkdown('alpha beta alpha');
  manager = createSearchManager({
    editor: instance.editor,
    panelRoot: element('search-panel'),
    onOpen,
  });
  manager.installKeyboardListeners();
  wireSearchButton(manager);
});

afterAll(() => {
  instance.destroy();
  document.body.innerHTML = '';
});

beforeEach(() => {
  if (manager.isOpen()) manager.close();
  element('overflow-popover').classList.add('hidden');
  onOpen.mockClear();
});

const button = () => element('indicator-search');
/**
 * What the button says about the panel. `aria-expanded` since #324: the button
 * reveals a surface, which is what the other three controls in this bar that
 * open one say, rather than switching an option on.
 */
const expanded = () => button().getAttribute('aria-expanded');
const findInput = () => element('search-input') as HTMLInputElement;

function chord(key: string, init: Partial<KeyboardEventInit> = {}): void {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

/** After a deferred focus has run: the panel's, and the editor's `focus` command. */
async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * **Each row asserts one of the two properties.** The rows in the first block
 * read whether the panel is open and never the expanded state; the rows in the
 * second read the expanded state and change the panel by some route other than
 * the button's own press. Written with both assertions in one row, removing the
 * state reddened every row the swap of the two commands reddened, so
 * that reversal witnessed nothing the other did not.
 */
describe('the magnifier is a toggle, and Ctrl+F is not (#312)', () => {
  it('opens the panel when it is closed', () => {
    button().click();

    expect(manager.isOpen()).toBe(true);
  });

  it('closes the panel when it is open, and hands the caret back to the document', async () => {
    button().click();
    button().click();
    await nextFrame();

    expect(manager.isOpen()).toBe(false);
    expect(document.activeElement).toBe(instance.editor.view.dom);
  });

  it('closes the replace row too', () => {
    chord('h', { ctrlKey: true });
    expect(manager.panel.mode()).toBe('replace');

    button().click();
    expect(manager.isOpen()).toBe(false);
  });

  it('runs the hook that closes the other floating surfaces when it opens, and not when it closes', () => {
    button().click();
    expect(onOpen).toHaveBeenCalledTimes(1);

    button().click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+F with the panel open leaves it open and returns to the find field with its text selected', async () => {
    button().click();
    findInput().value = 'alpha';
    await nextFrame();
    instance.editor.view.focus();
    expect(document.activeElement).toBe(instance.editor.view.dom);

    chord('f', { ctrlKey: true });
    await nextFrame();

    expect(manager.isOpen()).toBe(true);
    expect(document.activeElement).toBe(findInput());
    expect([findInput().selectionStart, findInput().selectionEnd]).toEqual([0, 5]);
  });

  it('the copy in the overflow menu reaches the button, both ways', () => {
    overflowClone(button()).click();
    expect(manager.isOpen()).toBe(true);

    overflowClone(button()).click();
    expect(manager.isOpen()).toBe(false);
  });
});

describe('the expanded state follows the panel, whatever moved it (#312, #324)', () => {
  it('ships collapsed, naming the panel it opens', () => {
    expect(button().getAttribute('aria-controls')).toBe('search-panel');
    expect(document.getElementById('search-panel')).not.toBeNull();
    expect(button().hasAttribute('aria-pressed')).toBe(false);
    expect(expanded()).toBe('false');
  });

  it('lights when the button opens the panel', () => {
    button().click();

    expect(expanded()).toBe('true');
  });

  it('goes dark when the toggle closes the panel', () => {
    manager.openFind();
    manager.toggleFind();

    expect(expanded()).toBe('false');
  });

  it('lights on Ctrl+F and on Ctrl+H', () => {
    chord('f', { ctrlKey: true });
    expect(expanded()).toBe('true');

    manager.close();
    chord('h', { ctrlKey: true });
    expect(expanded()).toBe('true');
  });

  it('goes dark on Escape in the find field', () => {
    manager.openFind();

    findInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(expanded()).toBe('false');
  });

  it('goes dark on the close cross', () => {
    manager.openFind();

    element('search-close').click();

    expect(expanded()).toBe('false');
  });

  it('stays lit through F3 and Shift+F3', () => {
    manager.openFind();

    chord('F3');
    chord('F3', { shiftKey: true });

    expect(expanded()).toBe('true');
  });

  it('reaches the copy in the overflow menu', () => {
    expect(overflowClone(button()).getAttribute('aria-expanded')).toBe('false');

    manager.openFind();
    expect(overflowClone(button()).getAttribute('aria-expanded')).toBe('true');
  });

  it('draws that copy again when the panel changes under an open overflow menu', () => {
    // The breakpoint's work, stated: happy-dom lays nothing out, and the menu
    // offers only what the breakpoint took out of the bar.
    for (const ind of document.querySelectorAll<HTMLElement>('#header-indicators .indicator')) {
      Object.defineProperty(ind, 'offsetParent', {
        value: ind === button() ? null : document.body,
        configurable: true,
      });
    }
    const popover = element('overflow-popover');
    popover.classList.remove('hidden');

    chord('f', { ctrlKey: true });

    expect(Array.from(popover.children, (copy) => copy.getAttribute('aria-expanded'))).toEqual([
      'true',
    ]);
  });
});

describe('the copy in the overflow menu says what it is (#312)', () => {
  it('reads Find rather than the whitespace around the icon', () => {
    expect(overflowClone(button()).textContent).toBe('Find');
  });

  it('keeps the text of an indicator that has some, and no state it does not have', () => {
    // The word count, since the spell-check toggle that stood here left the
    // bar for the Edit menu at #360.
    const words = overflowClone(element('word-count'));

    expect(words.textContent).toBe('– words');
    expect(words.hasAttribute('aria-pressed')).toBe(false);
    expect(words.hasAttribute('aria-expanded')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rules that draw it
// ─────────────────────────────────────────────────────────────────────────────

const shippedRules = stylesheetRules(stylesCss);

/**
 * The rules that apply while the pointer is on the element: each rule whose
 * selector names `:hover`, with `:hover` taken out and the rest run against the
 * element. happy-dom has no pointer, so `:hover` itself matches nothing.
 */
function hoverRulesReaching(target: Element, property: string): string[] {
  return shippedRules
    .filter((rule) => rule.selector.includes(':hover'))
    .filter((rule) => reaches(rule.selector.replaceAll(':hover', ''), target))
    .filter((rule) => rule.declarations.has(property))
    .map((rule) => rule.declarations.get(property) as string);
}

describe('the lit shade, as the stylesheet gives it (#312, #324)', () => {
  afterAll(() => button().setAttribute('aria-expanded', 'false'));

  it('shades the expanded button with the strong overlay and the collapsed one not at all', () => {
    button().setAttribute('aria-expanded', 'true');
    expect(valuesReaching(shippedRules, button(), 'background-color')).toEqual([
      'var(--hover-overlay-strong)',
    ]);

    button().setAttribute('aria-expanded', 'false');
    expect(valuesReaching(shippedRules, button(), 'background-color')).toEqual([]);
  });

  it('draws the hover as an image over that colour, so the pointer never hides a press', () => {
    for (const state of ['true', 'false']) {
      button().setAttribute('aria-expanded', state);
      expect(hoverRulesReaching(button(), 'background')).toEqual([]);
      expect(hoverRulesReaching(button(), 'background-color')).toEqual([]);
      expect(hoverRulesReaching(button(), 'background-image')).toHaveLength(1);
    }
  });

  it('shades the expanded copy in the overflow menu the same way', () => {
    button().setAttribute('aria-expanded', 'true');
    const copy = overflowClone(button());
    element('overflow-popover').appendChild(copy);

    expect(valuesReaching(shippedRules, copy, 'background-color')).toEqual([
      'var(--hover-overlay-strong)',
    ]);
    copy.remove();
  });
});

describe('the hover shade of the menu rows (#312)', () => {
  const panelOf = (entry: HTMLElement) => entry.closest<HTMLElement>('.menu-panel')!;

  it('changes an entry under the pointer, whose panel is the colour the old shade was', () => {
    const entry = element('menu-find');
    const shades = hoverRulesReaching(entry, 'background-color');

    expect(shades).toEqual(['var(--hover-overlay-strong)']);
    expect(hoverRulesReaching(entry, 'background')).toEqual([]);
    expect(valuesReaching(shippedRules, panelOf(entry), 'background')).not.toContain(shades[0]);
  });

  it('changes a section header under the pointer, which carries no line since #362', () => {
    const header = element('menu-section-edit');

    expect(hoverRulesReaching(header, 'background-color')).toEqual(['var(--hover-overlay-strong)']);
    expect(hoverRulesReaching(header, 'background')).toEqual([]);
    expect(hoverRulesReaching(header, 'background-image')).toEqual([]);
    // The hairline #294 drew between headers, which this row kept drawn under
    // the shade, went with #362.
    expect(valuesReaching(shippedRules, header, 'background-image')).toEqual([]);
  });

  it('does not shade an entry that cannot be chosen', () => {
    const undo = element('menu-undo') as HTMLButtonElement;
    undo.disabled = true;

    expect(hoverRulesReaching(undo, 'background-color')).toEqual([]);
    expect(hoverRulesReaching(undo, 'background')).toEqual([]);
    undo.disabled = false;
  });
});

describe('a regex that does not parse, through the real manager (#373)', () => {
  // The route the owner took on the artifact: an open parenthesis, then the
  // regex toggle, whose press runs the search at once. The count used to read
  // the engine text in full, with the pattern AgentEd built. One property per
  // row: the label, then the tooltip.
  function withBrokenRegex(check: (count: HTMLElement) => void): void {
    manager.openFind();
    findInput().value = '(';
    const regex = element('search-toggle-regex');
    regex.click();
    try {
      check(element('search-count'));
    } finally {
      regex.click();
      findInput().value = '';
    }
  }

  it('shows the short label', () => {
    withBrokenRegex((count) => expect(count.textContent).toBe('Pattern not valid'));
  });

  it('hands a reason to the tooltip, and takes it away once the pattern is plain again', () => {
    withBrokenRegex((count) => {
      expect(count.title).not.toBe('');
      expect(count.title).not.toBe(count.textContent);
    });
    expect(element('search-count').hasAttribute('title')).toBe(false);
  });
});
