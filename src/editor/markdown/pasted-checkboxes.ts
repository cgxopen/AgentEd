import { inertTemplate } from './inert-html';
import { markTaskLists } from './task-list';

/**
 * A task list pasted as HTML keeps its checkboxes (#689).
 *
 * A page draws a task item as a list item whose first node is a checkbox
 * input: GitHub writes `<li class=task-list-item><input type=checkbox …
 * checked> b</li>`, and a loose item puts the input first in the item's
 * paragraph, as `marked` does. Measured in Chromium on #689, the state of a
 * ticked box lives in the `checked` attribute of the input and nowhere else
 * on the clipboard. The pasted HTML is turned into markdown before it is read
 * back (`cleanPastedHtml`), and turndown writes nothing for an input, so the
 * checkbox was lost there: a task list arrived as plain bullets, and the space
 * the input left behind lifted a nested item out of its parent.
 *
 * So such an item is given here the shape a checkbox read from a file gets in
 * `parse.ts`: `data-type=taskItem` and `data-checked`, which the writer reads
 * and `markTaskLists` marks the list by. The state is taken from the presence
 * of `checked` on the input alone, as a browser reads it, so `checked=false`
 * is ticked; every other attribute of the input goes with the input. A page
 * could already say as much through `data-type` and `data-checked`, which
 * #447 keeps on purpose, so this lets in nothing that was kept out.
 *
 * Only the first node of an item of a `ul`, or of the item's first paragraph,
 * is read. A checkbox inside the text of an item, one in an ordered list,
 * which `task-list.ts` leaves as it is on purpose, an input of another type,
 * and a checkbox outside a list are left exactly as they were. A page that
 * nests the input in a `label` or a `span` is not read either: that is a
 * limit, and an AgentEd copy, whose input sits in a `label`, already carries
 * the two attributes.
 */

/** The first node of an element, a run of white space aside. */
function firstNode(element: Element): ChildNode | null {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() === '') continue;
    return child;
  }
  return null;
}

/** The checkbox an item opens with, and the element holding it, or null. */
function openingCheckbox(item: Element): { input: Element; holder: Element } | null {
  let holder = item;
  let first = firstNode(item);
  if (first instanceof Element && first.tagName === 'P') {
    holder = first;
    first = firstNode(first);
  }
  if (!(first instanceof Element) || first.tagName !== 'INPUT') return null;
  if (first.getAttribute('type')?.toLowerCase() !== 'checkbox') return null;
  return { input: first, holder };
}

/**
 * The pasted HTML with every bullet item that opens with a checkbox written as
 * a task item, or the HTML as it was when none does. Bounded by the items of
 * the pasted document, each visited once.
 */
export function pastedCheckboxesAsTaskItems(html: string): string {
  const template = inertTemplate(html);
  let changed = false;
  for (const item of Array.from(template.content.querySelectorAll('ul > li'))) {
    const opening = openingCheckbox(item);
    if (opening === null) continue;
    const { input, holder } = opening;
    item.setAttribute('data-type', 'taskItem');
    item.setAttribute('data-checked', input.hasAttribute('checked') ? 'true' : 'false');
    const after = input.nextSibling;
    holder.removeChild(input);
    if (after !== null && after.nodeType === Node.TEXT_NODE) {
      after.textContent = (after.textContent ?? '').replace(/^\s+/, '');
    }
    changed = true;
  }
  return changed ? markTaskLists(template.innerHTML) : html;
}
