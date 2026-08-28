/**
 * The task list is marked as one, and nothing else is (#110).
 *
 * These assert the two halves separately, because they fail separately: the
 * HTML pass here, and — at the editor level — the property the pass exists
 * for, that no empty `listItem` is left in front of a task list. The second
 * is the load-bearing one. It was invisible in the bytes for as long as
 * `listItem` took `paragraph block*`, and the widening in #110 is what turned
 * it into `- [ ] a` saving as `- - [ ] a`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';
import { markdownToHtml } from './parse';
import { markTaskLists } from './task-list';

describe('markTaskLists', () => {
  it('marks a list whose every item is a task item', () => {
    expect(
      markTaskLists('<ul><li data-type="taskItem" data-checked="false">a</li></ul>'),
    ).toContain('<ul data-type="taskList">');
  });

  it('leaves an ordinary list alone, and returns the very same string', () => {
    const html = '<ul><li>a</li><li>b</li></ul>';
    // Identity, not just equality: nothing is re-serialized through the DOM
    // for a document that has no task list in it at all.
    expect(markTaskLists(html)).toBe(html);
  });

  it('leaves a checkbox in an ordered list alone', () => {
    // `TaskList` renders as a `<ul>`; marking an `<ol>` would claim a shape
    // the serializer cannot honestly write back.
    const html = '<ol><li data-type="taskItem" data-checked="false">a</li></ol>';
    expect(markTaskLists(html)).toBe(html);
  });

  it('splits a list of mixed items into one list per run', () => {
    const out = markTaskLists(
      '<ul><li data-type="taskItem" data-checked="false">a</li><li>b</li></ul>',
    );
    expect(out).toBe(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">a</li></ul><ul><li>b</li></ul>',
    );
  });

  it('splits a run that starts plain, and keeps the order of the items', () => {
    const out = markTaskLists(
      '<ul><li>a</li><li data-type="taskItem" data-checked="true">b</li><li>c</li></ul>',
    );
    expect(out).toBe(
      '<ul><li>a</li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true">b</li></ul><ul><li>c</li></ul>',
    );
  });

  it('marks a task list nested inside an ordinary item', () => {
    expect(
      markTaskLists(
        '<ul><li>a<ul><li data-type="taskItem" data-checked="false">b</li></ul></li></ul>',
      ),
    ).toBe(
      '<ul><li>a<ul data-type="taskList"><li data-type="taskItem" data-checked="false">b</li></ul></li></ul>',
    );
  });

  it('moves an item without disturbing what it contains', () => {
    const out = markTaskLists(
      '<ul><li data-type="taskItem" data-checked="false">a<ul><li>deep</li></ul></li><li>b</li></ul>',
    );
    expect(out).toContain(
      '<li data-type="taskItem" data-checked="false">a<ul><li>deep</li></ul></li>',
    );
  });

  it('is what the parser actually applies, not only a function beside it', () => {
    expect(markdownToHtml('- [ ] a')).toContain('<ul data-type="taskList">');
  });
});

describe('no empty item is left in front of a task list, at the editor level', () => {
  let instance: EditorInstance | null = null;
  afterEach(() => {
    instance?.destroy();
    instance = null;
    document.body.innerHTML = '';
  });

  function docOf(markdown: string) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    instance = createEditor(host);
    instance.setMarkdown(markdown);
    return instance.editor.getJSON();
  }

  it.each([
    ['a task list on its own', '- [ ] a\n- [x] b'],
    ['a task list after a paragraph', 'text\n\n- [ ] a'],
    ['a task list nested under a bullet', '- a\n  - [ ] b'],
  ])('%s opens with no empty list item', (_label, markdown) => {
    // On `7d6cb13` every one of these opened as
    // `bulletList(listItem(paragraph)) | taskList(…)` — the empty item is the
    // whole defect, and it wrote nothing only by luck of the serializer.
    expect(JSON.stringify(docOf(markdown))).not.toContain(
      '{"type":"listItem","content":[{"type":"paragraph"}]}',
    );
  });

  it('opens a task list as a taskList rather than as a bullet list', () => {
    const json = JSON.stringify(docOf('- [ ] a'));
    expect(json).toContain('"type":"taskList"');
    expect(json).not.toContain('"type":"bulletList"');
  });
});
