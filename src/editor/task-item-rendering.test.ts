/**
 * Which elements the task-item rule reaches, on the DOM the editor builds (#164).
 *
 * **Half of #164 is testable here and half is not, and the line between them
 * is worth stating.** Whether `display: flex` reaches a nested plain `<li>` is
 * a question about a selector and a document — no layout engine is needed to
 * answer it, and it is exactly what broke. Whether the checkbox then sits
 * beside the heading or above it is layout, nothing in this repository renders
 * CSS, and no test here can say. That half rests on the owner's manual pass,
 * which is also how the defect was found: by a screenshot, on a pull request
 * whose byte checks were green three saves deep.
 *
 * ── Why the selector is read rather than restated ──
 *
 * A test that spells the selector again pins nothing: it would go green with
 * `src/styles.css` saying something else entirely. So the selector is read out
 * of that file, the way `.github/workflows/ci.test.ts` reads `ci.yml`, and
 * what is asserted is its **reach** against a real document.
 *
 * The assertion is a property rather than a list, and it has two halves that
 * fail for opposite reasons:
 *
 *  - **Sound** — every `<li>` the rule reaches is a task item. This is the
 *    half that was false: an ordinary list nested inside a task item had its
 *    items turned into flex rows, and an element that is not a list item draws
 *    no marker.
 *  - **Complete** — every task item in the document is reached. This is the
 *    half a hurried narrowing would break, and the one that matters most for a
 *    **nested task list**: its `<ul>` carries `data-type="taskList"` itself, so
 *    it reaches its own items through it rather than through the outer list.
 *
 * ── The live DOM, not `getHTML` ──
 *
 * The two spell a task item differently: the node view builds the `<li>` and
 * writes only `data-checked` on it, while `renderHTML` also writes
 * `data-type="taskItem"`. #159 recorded that difference. CSS meets the first
 * one, so that is what these read.
 */
import { afterEach, describe, expect, it } from 'vitest';
// The stylesheet, as text, the way `.github/workflows/ci.test.ts` reads the
// workflows it pins. `?inline` rather than `?raw` because a `.css` import goes
// through Vite's stylesheet pipeline either way, and `css: true` in
// `vite.config.ts` is what switches that pipeline on under vitest — without it
// both queries hand back an **empty string**, and a test that read nothing
// would assert nothing and pass. `STYLES` is checked for length below for that
// reason.
import STYLES from '../styles.css?inline';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

/**
 * The selector `src/styles.css` uses to make a task item a flex row.
 *
 * Found by what it *does* — the rule carrying `display: flex` inside the
 * task-list block — rather than by its text, so renaming or reordering the
 * declarations cannot make this test quietly stop looking at the right rule.
 * If the rule is gone, this throws rather than silently asserting nothing.
 */
function taskItemRowSelector(): string {
  // An empty stylesheet is the one way this test can pass while looking at
  // nothing, so it is refused before anything is matched against it.
  if (STYLES.length === 0) {
    throw new Error(
      'src/styles.css read as an empty string. `css: true` under `test` in vite.config.ts is ' +
        'what makes a stylesheet readable here (#164); without it this test asserts nothing.',
    );
  }
  const rule = STYLES.match(
    /\n(\.tiptap ul\[data-type="taskList"\][^{}]*?)\{[^}]*?display:\s*flex[^}]*?\}/,
  );
  if (!rule) {
    throw new Error(
      'src/styles.css no longer has a rule giving a task item `display: flex` (#164). ' +
        'If the item is laid out some other way now, this test is the wrong shape, not the CSS.',
    );
  }
  return rule[1].trim();
}

/** The document, rendered, as the browser would hand it to the stylesheet. */
function render(markdown: string): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance.editor.view.dom as HTMLElement;
}

/** Is this `<li>` an item of a task list, rather than of an ordinary one? */
function isTaskItem(item: Element): boolean {
  return item.parentElement?.getAttribute('data-type') === 'taskList';
}

/** What an item is, said the way a failure message has to say it. */
function describeItem(item: Element): string {
  const parent = item.parentElement;
  const kind = parent?.nodeName === 'OL' ? 'ordered' : isTaskItem(item) ? 'task' : 'bullet';
  return `${kind} item ${JSON.stringify((item.textContent ?? '').trim().slice(0, 30))}`;
}

/**
 * Every shape the rule has to get right, and the depths are the point: the
 * selector reaches through the `<ul>`, so nesting is where a wrong answer
 * hides. The last four are the floor — nothing in them may change.
 */
const DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ['a plain list under a task item', '- [ ] a\n  - b'],
  ['an ordered list under a task item', '- [ ] a\n  1. b'],
  ['three levels of plain list under a task item', '- [ ] a\n  - b\n    - c\n      - d'],
  ['a plain list under a task item under a task item', '- [ ] a\n  - [ ] b\n    - c'],
  ['a task list under a plain bullet under a task item', '- [ ] a\n  - b\n    - [ ] c'],
  ['a task list under a task item', '- [ ] a\n  - [x] b'],
  ['a task list under a plain bullet', '- a\n  - [ ] b'],
  ['a task list under an ordered item', '1. a\n   - [ ] b'],
  ['a heading as a task item body', '- [ ] ## h'],
  ['an ordinary task list', '- [ ] a\n- [x] b'],
  ['an ordinary bullet list', '- a\n- b'],
  ['an ordinary ordered list', '1. a\n2. b'],
];

describe('the task-item row rule reaches task items and nothing else (#164)', () => {
  it.each(DOCUMENTS)('is sound for %s', (_label, markdown) => {
    // Every item it reaches is a task item. An ordinary item turned into a
    // flex row stops being a list item and draws no marker, which is the
    // defect this half exists for.
    const reached = Array.from(render(markdown).querySelectorAll(taskItemRowSelector()));
    expect(reached.filter((item) => !isTaskItem(item)).map(describeItem)).toEqual([]);
  });

  it.each(DOCUMENTS)('is complete for %s', (_label, markdown) => {
    // Every task item is reached. Without this the narrowing could be made to
    // pass by reaching nothing at all, and a nested task list — whose own
    // `<ul>` carries the attribute — is where it would show first.
    const dom = render(markdown);
    const reached = new Set(Array.from(dom.querySelectorAll(taskItemRowSelector())));
    const everyTaskItem = Array.from(dom.querySelectorAll('li')).filter(isTaskItem);
    expect(everyTaskItem.filter((item) => !reached.has(item)).map(describeItem)).toEqual([]);
  });

  it('reaches the nested task list of a mixed document, at both levels', () => {
    // The two halves above are per-document properties and would both hold if
    // a document had no task item at all. This names the count for the one
    // shape the narrowing could plausibly have broken.
    const dom = render('- [ ] outer\n  - [x] inner');
    expect(dom.querySelectorAll(taskItemRowSelector())).toHaveLength(2);
  });

  it('leaves an ordinary list item alone entirely', () => {
    const dom = render('- [ ] a\n  - b');
    const plain = Array.from(dom.querySelectorAll('li')).filter((item) => !isTaskItem(item));
    expect(plain).toHaveLength(1);
    expect(plain[0].matches(taskItemRowSelector())).toBe(false);
  });
});

/**
 * The structure the second half of the fix stands on (#164).
 *
 * This does **not** assert that a declaration exists — a test like that would
 * pass with the wrong value in it and the defect fully present. What it pins
 * is the shape the rule has to match against: the extension renders a task
 * item as a label and a content wrapper, and the item's first block is the
 * wrapper's first child. `serialize.ts` already depends on that same shape.
 *
 * If a future release renders the item differently, the margin rule stops
 * matching and the checkbox goes back above the heading, silently. This is
 * what would say so.
 */
describe('a task item renders as a checkbox beside a content wrapper (#164)', () => {
  it.each([
    ['a paragraph', '- [ ] plain text', 'P'],
    ['a heading', '- [ ] ## h', 'H2'],
    ['a blockquote', '- [ ] > q', 'BLOCKQUOTE'],
    ['a fenced block', '- [ ] ```\n  code\n  ```', 'PRE'],
    ['a bullet list', '- [ ] - a', 'UL'],
    ['an ordered list', '- [ ] 1. a', 'OL'],
    ['a table', '- [ ] | a | b |\n  | --- | --- |\n  | 1 | 2 |', 'TABLE'],
    ['a horizontal rule', '- [ ] ---', 'HR'],
  ])('holds %s as the wrapper first child', (_label, markdown, expected) => {
    const item = render(markdown).querySelector('ul[data-type="taskList"] > li');
    expect(Array.from(item?.children ?? []).map((child) => child.nodeName)).toEqual([
      'LABEL',
      'DIV',
    ]);
    expect(item?.children[1].firstElementChild?.nodeName).toBe(expected);
  });
});
