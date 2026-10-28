import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { moveAdjacencyMarks } from './adjacency';
import { labelText, rewriteCheckboxes } from './parse';
import { markTaskLists } from './task-list';

/**
 * The HTML of a file is parsed in a template before the sanitizer (#664).
 *
 * What these rows can see is where each pass parses it: every assignment to
 * `innerHTML` that carries the probe below is recorded, with the element it
 * targets. A pass passes when the probe went into a template and into no other
 * element of the live document. That the content of a template is inert, so
 * that nothing in it loads or runs, is not visible here: happy-dom gives the
 * content of a template the live document as its owner. It was measured in
 * Chromium on #664 and is recorded in `inert-html.ts`.
 */
const PROBE = 'data-probe-664';

interface Assignment {
  readonly template: boolean;
  readonly liveOwner: boolean;
}

const recorded: Assignment[] = [];
const restore: Array<() => void> = [];

/** Wrap the `innerHTML` setter `owner` defines, if it defines one, to record what carries the probe. */
function watch(owner: object): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, 'innerHTML');
  if (!descriptor?.set || !descriptor.get) return;
  const { get, set } = descriptor;
  Object.defineProperty(owner, 'innerHTML', {
    configurable: true,
    get() {
      return get.call(this);
    },
    set(value: string) {
      if (String(value).includes(PROBE)) {
        const element = this as Element;
        recorded.push({
          template: element instanceof HTMLTemplateElement,
          liveOwner: element.ownerDocument === document,
        });
      }
      set.call(this, value);
    },
  });
  restore.push(() => Object.defineProperty(owner, 'innerHTML', descriptor));
}

beforeEach(() => {
  recorded.length = 0;
  watch(Element.prototype);
  watch(HTMLTemplateElement.prototype);
});

afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
});

/** The assignments that put the probe into an element of the live document other than a template. */
const intoLiveElements = () => recorded.filter((entry) => !entry.template && entry.liveOwner);
const intoTemplates = () => recorded.filter((entry) => entry.template);

describe('the HTML a pass reads before the sanitizer is parsed in a template (#664)', () => {
  it('rewriteCheckboxes', () => {
    const out = rewriteCheckboxes(
      `<ul>\n<li><input type="checkbox"> a <b ${PROBE}>x</b></li>\n</ul>`,
    );
    expect(out).toContain('data-type="taskItem"');
    expect(intoTemplates().length).toBeGreaterThan(0);
    expect(intoLiveElements()).toEqual([]);
  });

  it('markTaskLists', () => {
    const out = markTaskLists(`<ul>\n<li data-type="taskItem">a <b ${PROBE}>x</b></li>\n</ul>`);
    expect(out).toContain('data-type="taskList"');
    expect(intoTemplates().length).toBeGreaterThan(0);
    expect(intoLiveElements()).toEqual([]);
  });

  it('moveAdjacencyMarks', () => {
    const out = moveAdjacencyMarks(`<agented-adjacent></agented-adjacent><p ${PROBE}>x</p>`);
    expect(out).not.toContain('agented-adjacent>');
    expect(intoTemplates().length).toBeGreaterThan(0);
    expect(intoLiveElements()).toEqual([]);
  });

  it('labelText', () => {
    expect(labelText(`a <b ${PROBE}>x</b>`)).toBe('a x');
    expect(intoTemplates().length).toBeGreaterThan(0);
    expect(intoLiveElements()).toEqual([]);
  });
});

describe('a task list inside a raw noscript block keeps its markers (#664)', () => {
  // In Chromium a `div` of the live document parsed the content of a
  // `noscript` as text, so `main` saw no checkbox there and a save wrote the
  // items without their markers; a template parses it as markup. happy-dom
  // parses it as markup in a `div` too, so this row pins the outcome and would
  // pass on `main` as well: the difference was measured in Chromium only.
  it('the checkbox inside the noscript is rewritten as a task item', () => {
    const out = rewriteCheckboxes(
      '<noscript>\n<ul>\n<li><input disabled="" type="checkbox"> a</li>\n</ul>\n</noscript>\n',
    );
    expect(out).toContain('<li data-type="taskItem" data-checked="false">a</li>');
  });
});
