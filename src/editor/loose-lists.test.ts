/**
 * A list keeps the spacing the file gave it (#28).
 *
 * The round-trip table next door pins the bytes shape by shape. This file
 * carries the halves the table cannot state: that the parent directory of the
 * behaviour — the file's own spelling — is what decides the byte, that the
 * two halves fail for opposite reasons, and that the editor draws what the
 * save will write.
 *
 * Everything here runs the ordinary open path, `createEditor` + `setMarkdown`,
 * so a stub of the serializer cannot produce the evidence.
 */
import { afterEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

function open(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** Open `markdown`, save it unedited, return what it wrote. */
/** Byte length, without reaching for a Node global the browser build has not got. */
function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function openAndSave(markdown: string): string {
  const editor = open(markdown);
  const saved = editor.getMarkdown().trim();
  editor.destroy();
  instance = null;
  return saved;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 + 3 — both halves, and they fail for opposite reasons
// ─────────────────────────────────────────────────────────────────────────────

describe('a list round-trips in the spelling the file used', () => {
  const SHAPES: ReadonlyArray<readonly [string, string]> = [
    ['a loose bullet list', '- one\n\n- two'],
    ['a tight bullet list', '- one\n- two'],
    ['a loose ordered list', '1. one\n\n2. two'],
    ['a tight ordered list', '1. one\n2. two'],
    ['a loose task list', '- [ ] a\n\n- [x] b'],
    ['a tight task list', '- [ ] a\n- [x] b'],
  ];

  it.each(SHAPES)('%s is byte-identical', (_label, markdown) => {
    expect(openAndSave(markdown)).toBe(markdown);
  });

  it.each(SHAPES)('%s is byte-identical on the second save too', (_label, markdown) => {
    const once = openAndSave(markdown);
    expect(openAndSave(once)).toBe(once);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — per list, not per document
// ─────────────────────────────────────────────────────────────────────────────

describe('each list in a document keeps its own spacing', () => {
  it('a loose list and a tight list in one file each keep their form', () => {
    const md = '- a\n\n- b\n\ntext\n\n- c\n- d';
    expect(openAndSave(md)).toBe(md);
  });

  it('a loose outer list with a tight inner one keeps both', () => {
    const md = '- one\n  - inner\n\n- two';
    expect(openAndSave(md)).toBe(md);
  });

  it('a tight outer list with a loose inner one keeps both', () => {
    const md = '- one\n  - i1\n\n  - i2\n- two';
    expect(openAndSave(md)).toBe(md);
  });

  it('a loose bullet list beside a tight ordered one keeps both', () => {
    const md = '- a\n\n- b\n\ntext\n\n1. c\n2. d';
    expect(openAndSave(md)).toBe(md);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The shape that used to gain a byte, which is the mirror image of the
// exception being removed and lived in the same function.
// ─────────────────────────────────────────────────────────────────────────────

describe('a list spelled tight between its items does not gain a blank line', () => {
  it('an item holding two blocks, tight between the items, is byte-identical', () => {
    // CommonMark calls this list loose — an item holds more than one block —
    // so `marked` wraps both item bodies in `<p>`. The file is spelled tight
    // between its items, and the file is what decides. Measured before the
    // repair at 26 bytes in and 27 out.
    const md = '- one\n\n  second para\n- two';
    expect(bytes(md)).toBe(26);
    const saved = openAndSave(md);
    expect(bytes(saved)).toBe(26);
    expect(saved).toBe(md);
  });

  it('the same shape spelled loose between its items keeps its blank line', () => {
    const md = '- one\n\n  second para\n\n- two';
    expect(openAndSave(md)).toBe(md);
  });

  it('the two differ by exactly the blank line the file carried', () => {
    const tight = '- one\n\n  second para\n- two';
    const loose = '- one\n\n  second para\n\n- two';
    expect(bytes(loose) - bytes(tight)).toBe(1);
    expect(openAndSave(loose)).not.toBe(openAndSave(tight));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 — a list created in the editor is tight
// ─────────────────────────────────────────────────────────────────────────────

describe('a list created in the editor is tight', () => {
  it('a bullet list made with the toolbar command writes tight', () => {
    // A real editing gesture rather than a constructed node: this is the
    // command the toolbar button dispatches, and `enter` is the key the user
    // presses for the second item.
    const editor = open('');
    editor.editor.commands.toggleBulletList();
    editor.editor.commands.insertContent('one');
    editor.editor.commands.enter();
    editor.editor.commands.insertContent('two');
    const saved = editor.getMarkdown().trim();
    editor.destroy();
    instance = null;

    expect(saved).toBe('- one\n- two');
  });

  it('an ordered list and a task list made the same way write tight', () => {
    const ordered = open('');
    ordered.editor.commands.toggleOrderedList();
    ordered.editor.commands.insertContent('one');
    ordered.editor.commands.enter();
    ordered.editor.commands.insertContent('two');
    const orderedSaved = ordered.getMarkdown().trim();
    ordered.destroy();
    instance = null;
    expect(orderedSaved).toBe('1. one\n2. two');

    const task = open('');
    task.editor.commands.toggleTaskList();
    task.editor.commands.insertContent('one');
    task.editor.commands.enter();
    task.editor.commands.insertContent('two');
    const taskSaved = task.getMarkdown().trim();
    task.destroy();
    instance = null;
    expect(taskSaved).toBe('- [ ] one\n- [ ] two');
  });

  it('an item added to a list the file spelled loose stays in that list form', () => {
    // The attribute belongs to the list, so a new item joins the spelling the
    // list already has rather than resetting it.
    const editor = open('- one\n\n- two');
    editor.editor.commands.focus('end');
    editor.editor.commands.enter();
    editor.editor.commands.insertContent('three');
    const saved = editor.getMarkdown().trim();
    editor.destroy();
    instance = null;

    expect(saved).toBe('- one\n\n- two\n\n- three');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 — the display half, read off the stylesheet rather than repeated
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The selector the stylesheet actually uses for a loose item, read from
 * `styles.css` rather than restated here. The precedent is `ci.test.ts`
 * reading `ci.yml`: a test that repeats the string it is checking goes on
 * passing when the file it describes has moved.
 */
function looseItemSelector(): string {
  const blocks = stylesCss.split('}');
  const rule = blocks.find((block) => block.includes('[data-loose="true"]'));
  if (rule === undefined) throw new Error('styles.css has no rule for a loose list item (#28)');
  const selector = rule.slice(rule.lastIndexOf('*/') + 2, rule.indexOf('{')).trim();
  if (selector.length === 0) throw new Error('could not read the loose-list selector');
  return selector;
}

describe('the editor draws a loose list loose', () => {
  it('styles.css carries a rule for a loose list item', () => {
    expect(looseItemSelector()).toContain('[data-loose="true"]');
  });

  it('everything the selector reaches is an item of a loose list', () => {
    const editor = open('- loose a\n\n- loose b\n\ntext\n\n- tight a\n- tight b');
    const root = editor.editor.view.dom;
    const matched = Array.from(
      root.querySelectorAll(looseItemSelector().replace(/\.tiptap /g, '')),
    );

    expect(matched.length).toBeGreaterThan(0);
    for (const element of matched) {
      expect(element.nodeName).toBe('LI');
      expect(element.parentElement?.getAttribute('data-loose')).toBe('true');
    }
  });

  it('it reaches every item of every loose list, and no item of a tight one', () => {
    const editor = open('- loose a\n\n- loose b\n\ntext\n\n- tight a\n- tight b');
    const root = editor.editor.view.dom;
    const selector = looseItemSelector().replace(/\.tiptap /g, '');
    const matched = new Set(root.querySelectorAll(selector));

    const looseItems = Array.from(root.querySelectorAll('[data-loose="true"] > li'));
    const tightLists = Array.from(root.querySelectorAll('ul, ol')).filter(
      (list) => list.getAttribute('data-loose') !== 'true',
    );

    expect(looseItems.length).toBe(2);
    for (const item of looseItems) expect(matched.has(item)).toBe(true);

    for (const list of tightLists) {
      for (const item of Array.from(list.children)) expect(matched.has(item)).toBe(false);
    }
  });

  it('a tight list carries no attribute for the selector to find', () => {
    const editor = open('- one\n- two');
    const lists = Array.from(editor.editor.view.dom.querySelectorAll('ul'));
    expect(lists.length).toBe(1);
    expect(lists[0].hasAttribute('data-loose')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #200 — the document that used to cost every list its spacing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The spacing used to be paired with the parsed HTML by document order, and a
 * list the file wrote as **raw HTML** is invisible to that walk while it is
 * visible to `querySelectorAll`. The counts disagreed, nothing was written,
 * and every loose list in the document came back tight — not only the
 * hand-written one.
 *
 * These documents assert the repair at the level the numbers were taken at.
 * They are **not** byte-identical, and the reason is a different question that
 * #200 records and leaves: a list the file wrote as raw HTML does not survive
 * to the file at all today, it is rewritten as a markdown list. So what is
 * pinned here is the exact bytes, which state both halves at once — the
 * markdown list keeps its blank lines, and the raw one is rewritten.
 */
describe('a raw HTML list no longer costs the rest of the document its spacing', () => {
  it('a loose list beside a hand-written list keeps its blank line', () => {
    const md = '- a\n\n- b\n\n<ul>\n<li>one</li>\n</ul>';
    // Before the repair: `- a`, `- b`, blank, `- one` — the loose list tight.
    expect(openAndSave(md)).toBe('- a\n\n- b\n\n- one');
  });

  it('a details block holding a list costs the loose list nothing', () => {
    // The shape a README carries, and the reason this was reachable at all.
    const md =
      '- a\n\n- b\n\n<details>\n<summary>more</summary>\n<ul>\n<li>one</li>\n</ul>\n</details>';
    expect(openAndSave(md)).toBe('- a\n\n- b\n\nmore\n\n- one');
  });

  it('the hand-written list itself is written tight, which is what it was', () => {
    const md = '<ul>\n<li>one</li>\n<li>two</li>\n</ul>';
    expect(openAndSave(md)).toBe('- one\n- two');
  });

  it('and the second save moves nothing further', () => {
    const md = '- a\n\n- b\n\n<ul>\n<li>one</li>\n</ul>';
    const once = openAndSave(md);
    expect(openAndSave(once)).toBe(once);
  });
});

/**
 * A nested list is rendered by its own call, so it reads its own spelling
 * (#200). The rows above pair a loose list with a tight one and would still
 * pass if nesting were answered by the list around it; this one holds no tight
 * list at all, which is what separates the two claims.
 *
 * It is asserted as exact bytes rather than as byte-identity, and the reason is
 * not this change: the blank line **before** a nested list is dropped, on this
 * branch and on `main` alike, and nothing here moves it either way. What the
 * bytes state is the part #200 is about — the outer list keeps the blank lines
 * between its items and the inner list keeps its own.
 */
describe('a nested list reads its own spacing', () => {
  it('a loose list inside a loose list keeps both spacings', () => {
    expect(openAndSave('- a\n\n  - x\n\n  - y\n\n- b')).toBe('- a\n  - x\n\n  - y\n\n- b');
  });

  it('and the second save moves nothing further', () => {
    const once = openAndSave('- a\n\n  - x\n\n  - y\n\n- b');
    expect(openAndSave(once)).toBe(once);
  });
});
