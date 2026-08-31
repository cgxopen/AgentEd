import { marked } from 'marked';

/**
 * How a list was spaced in the file it came from (#28).
 *
 * A CommonMark list is **loose** when blank lines separate its items, and its
 * items then render wrapped in `<p>` with real vertical space between them.
 * AgentEd used to write every list back tight, so a document opened and saved
 * with no edits rendered differently afterwards — the first R-C2 exception
 * recorded, and the one this module removes.
 *
 * **The spelling is a property of the file**, the way a table's column widths
 * are (#93), and like those it has to be read from the raw markdown: by the
 * time the HTML exists the distinction is still visible, but by the time the
 * *document model* exists it is not. `listItem` takes `block+`, so both
 * spellings arrive as `listItem(paragraph)` and `editor.getHTML()` re-emits
 * the wrapper for a tight list too — measured, and it is why an attribute is
 * needed at all rather than a serializer repair.
 *
 * ── Why the `<p>` wrapper is not the thing to read ──
 *
 * `marked` wraps item bodies in `<p>` for **two** different reasons, because
 * CommonMark calls a list loose when its items are separated by blank lines
 * **or** when any one item holds more than one block. So this file:
 *
 * ```
 * - one
 *
 *   second para
 * - two
 * ```
 *
 * is spelled **tight between its items** and still arrives fully wrapped.
 * An attribute read off the wrapper would call it loose and the serializer
 * would write a blank line the file never had — measured at 26 bytes in and
 * 27 out, which is the mirror image of the exception being removed and lived
 * in the same function. So what is read here is the file's own spacing: a
 * blank line at the end of an item that is not the last.
 *
 * ── Pairing, and what happens when it is not certain ──
 *
 * Lists are matched to the HTML by document order, and a depth-first walk of
 * the token tree visits an outer list before the lists inside it exactly as
 * `querySelectorAll('ul, ol')` does. If the two counts disagree the detection
 * is not trustworthy and **nothing is written** — the same refusal
 * `attachTableStyles` makes, and for the same reason: a spelling attached to
 * the wrong list is worse than no spelling at all.
 */
export const LIST_SPACING_ATTRIBUTE = 'data-loose';

/** A blank line ending an item — the file's own spacing, not CommonMark's. */
const ENDS_WITH_BLANK_LINE = /\n[ \t]*\n$/;

interface ListToken {
  readonly type?: string;
  readonly items?: ReadonlyArray<{ readonly raw?: string; readonly tokens?: unknown[] }>;
  readonly tokens?: unknown[];
}

/**
 * Whether this list is spelled loose: any item but the last ends with a blank
 * line. The last item is excluded because a blank line after it separates the
 * list from whatever follows rather than one item from another.
 */
function isSpelledLoose(items: ListToken['items']): boolean {
  if (items === undefined || items.length < 2) return false;
  return items.slice(0, -1).some((item) => ENDS_WITH_BLANK_LINE.test(item.raw ?? ''));
}

function walk(tokens: readonly unknown[], out: boolean[]): void {
  for (const token of tokens as readonly ListToken[]) {
    if (token.type === 'list') {
      out.push(isSpelledLoose(token.items));
      for (const item of token.items ?? []) walk(item.tokens ?? [], out);
      continue;
    }
    // A list can also sit inside a blockquote or another container, whose
    // token carries its children under the same key.
    if (Array.isArray(token.tokens)) walk(token.tokens, out);
  }
}

/** Whether each list in `markdown` is spelled loose, in document order. */
export function detectListSpacing(markdown: string): boolean[] {
  const spacing: boolean[] = [];
  walk(marked.lexer(markdown), spacing);
  return spacing;
}

/**
 * Write each list's own spacing onto the `<ul>`/`<ol>` it belongs to.
 *
 * Only detection may set the attribute: a document carrying one in raw HTML
 * would otherwise choose how its own list is written back.
 */
export function attachListSpacing(html: string, markdown: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  const lists = container.querySelectorAll('ul, ol');
  for (const list of lists) list.removeAttribute(LIST_SPACING_ATTRIBUTE);
  if (lists.length === 0) return html;

  const spacing = detectListSpacing(markdown);
  if (spacing.length !== lists.length) return container.innerHTML;

  lists.forEach((list, index) => {
    if (spacing[index]) list.setAttribute(LIST_SPACING_ATTRIBUTE, 'true');
  });
  return container.innerHTML;
}
