import { labelText, lexMarkdown } from './parse';
import { REFERENCE_DEFINITION_ATTRIBUTE } from './reference';

/**
 * What a save asks of the reference definitions and links of a document
 * (#570): kept apart from `reference.ts`, which `parse.ts` imports, since
 * these ask the parser in turn. See `reference.ts`.
 */

/** The indentation of the first line of a reference definition, or nothing (#570). */
export function referenceIndentOf(element: HTMLElement): string {
  const value = element.getAttribute(REFERENCE_DEFINITION_ATTRIBUTE);
  if (value === null) return '';
  try {
    const indent = decodeURIComponent(value);
    return /^[ \t]{0,3}$/.test(indent) ? indent : '';
  } catch (error) {
    if (error instanceof URIError) return '';
    throw error;
  }
}

/** Whether the text a reader sees of a link still reads as `label` (#570, E1). */
export function readsAs(text: string | null): (label: string) => boolean {
  const flat = (value: string) => value.replace(/\s+/g, ' ').trim();
  return (label) => flat(text ?? '') === flat(labelText(label));
}

/**
 * The labels the reference definitions of `html` define, folded: their text
 * read by the `def` tokenizer of `marked`, so a definition edited into
 * something else defines nothing and its links are written inline (#570, R2).
 */
export function definedLabels(html: string, inACell: (element: Element) => boolean): Set<string> {
  const labels = new Set<string>();
  if (!html.includes(REFERENCE_DEFINITION_ATTRIBUTE)) return labels;
  const box = document.createElement('template');
  box.innerHTML = html;
  for (const element of Array.from(
    box.content.querySelectorAll(`[${REFERENCE_DEFINITION_ATTRIBUTE}]`),
  )) {
    if (inACell(element)) continue;
    const lines: string[] = [''];
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeName === 'BR') lines.push('');
      else lines[lines.length - 1] += child.textContent ?? '';
    }
    const links = (lexMarkdown(lines.join('\n')) as unknown as { links: Record<string, unknown> })
      .links;
    for (const label of Object.keys(links)) labels.add(label);
  }
  return labels;
}
