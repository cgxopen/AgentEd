/**
 * Which `<ul>` is a task list, said in the one spelling TipTap reads (#110).
 *
 * `marked` writes a GFM task list as an ordinary `<ul>` whose items open with
 * a checkbox input; `parse.ts` rewrites those inputs into the
 * `<li data-type="taskItem">` the TipTap extension parses. **The list around
 * them was never rewritten**, and `TaskList.parseHTML` matches only
 * `ul[data-type="taskList"]` — so ProseMirror opened a `bulletList` for the
 * `<ul>`, found an item that cannot live in one, and closed it again,
 * **leaving an empty `listItem` behind** before every task list in the
 * document. Measured on `7d6cb13`: `- [ ] a` parses to
 * `bulletList(listItem(paragraph)) | taskList(taskItem(paragraph("a")))`.
 *
 * That leftover was invisible in the bytes for as long as `listItem` took
 * `paragraph block*`, because an empty item wrote nothing and the task list
 * beside it wrote itself. It stops being invisible the moment `listItem`
 * admits a leading block: the empty item can then *hold* the task list, and
 * `- [ ] a` saves as `- - [ ] a` — a bullet the user never typed, which is
 * R-C2. So this is not a fix travelling with #110 for convenience; it is the
 * defect that makes #110's own fix safe, and neither may be removed while
 * reading only the other.
 *
 * **A list with only some items checked is split rather than marked.** A
 * `taskList` takes `taskItem+` and nothing else, so marking a mixed list
 * would refuse its plain items exactly as the unmarked list refused its task
 * items — the same defect with the roles swapped. Each run of consecutive
 * items of one kind becomes its own list, which is what the document model
 * can hold and what `7d6cb13` already wrote for such a list anyway: measured,
 * `- [ ] a\n- b` saved as `- [ ] a\n\n- b` before this change and after it.
 *
 * Only `<ul>` is considered. A checkbox inside an ordered list is left
 * exactly as it was, because `TaskList` renders as a `<ul>` and marking an
 * `<ol>` would claim a shape this cannot honestly write back.
 */

/** The attribute `TaskList.parseHTML` matches on, and `TaskItem` already carries. */
const TASK_LIST_TYPE = 'taskList';
const TASK_ITEM_TYPE = 'taskItem';

function isTaskItem(element: Element): boolean {
  return element.getAttribute('data-type') === TASK_ITEM_TYPE;
}

/**
 * Regroup one list's direct items into consecutive runs of a single kind,
 * each in its own `<ul>`, and mark the task-item runs.
 *
 * The item elements are **moved**, not cloned, so whatever they contain —
 * nested lists included — travels with them untouched.
 */
function splitMixedList(list: Element, items: readonly Element[]): void {
  const parent = list.parentNode;
  if (!parent) return;

  let run: Element | null = null;
  let runIsTask: boolean | null = null;

  for (const item of items) {
    const itemIsTask = isTaskItem(item);
    if (run === null || runIsTask !== itemIsTask) {
      run = list.ownerDocument.createElement('ul');
      if (itemIsTask) run.setAttribute('data-type', TASK_LIST_TYPE);
      parent.insertBefore(run, list);
      runIsTask = itemIsTask;
    }
    run.appendChild(item);
  }

  parent.removeChild(list);
}

/**
 * Mark every task list in `html` so TipTap parses it as one.
 *
 * Runs after the checkbox rewrite in `parse.ts` and before sanitization, on
 * the same detached container the table-style pass uses. The scan is bounded
 * by the number of `<ul>` elements the parsed document has: the list is taken
 * as a snapshot first, and an item is only ever moved between lists, so no
 * list is visited twice and nothing is created that is then re-scanned.
 */
export function markTaskLists(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  const lists = Array.from(container.querySelectorAll('ul'));
  if (lists.length === 0) return html;

  let changed = false;
  for (const list of lists) {
    const items = Array.from(list.children).filter((child) => child.tagName === 'LI');
    if (items.length === 0 || !items.some(isTaskItem)) continue;

    changed = true;
    if (items.every(isTaskItem)) {
      list.setAttribute('data-type', TASK_LIST_TYPE);
    } else {
      splitMixedList(list, items);
    }
  }

  return changed ? container.innerHTML : html;
}
