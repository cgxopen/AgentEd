import { LIST_MARKER_ATTRIBUTE, markerFor } from './list-marker';

/**
 * A rule that opens an item of a `-` list, written with stars (#606).
 *
 * The serializer writes every rule `---`. As the first block of a bullet item
 * that made `- ---`, which CommonMark reads as a rule of its own, so the item
 * held on the first save and the second dropped the list: `- * * *` came back
 * `- ---` and then as a rule, CommonMark example 61, alone, under an item or
 * in a quote. Since #431 a list is written with the marker the file gave it,
 * so only a `-` list meets its own rule: `* ---`, `+ ---` and `1. ---` are an
 * item holding a rule to every reader. There the rule is written `***`, which
 * neither the marker nor CommonMark joins into one rule with it.
 */
export const RULE_IN_A_DASH_ITEM = '***';

/** Whether `rule` is the first thing in an item of a list written with `-`. */
export function opensADashItem(rule: Node): boolean {
  const item = rule.parentElement;
  if (item?.nodeName !== 'LI') return false;
  for (let before = rule.previousSibling; before !== null; before = before.previousSibling) {
    if (before.nodeType !== 3 || (before.textContent ?? '').trim() !== '') return false;
  }
  const list = item.parentElement;
  if (list?.nodeName !== 'UL') return false;
  return markerFor(list.getAttribute(LIST_MARKER_ATTRIBUTE), false) === '-';
}
