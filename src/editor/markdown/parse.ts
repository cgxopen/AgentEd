import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { attachTableStyles, TABLE_STYLE_ATTRIBUTE } from './table-style';
import { markTaskLists } from './task-list';

// Configure marked for GFM compatibility
marked.setOptions({
  gfm: true,
  breaks: false,
});

// GFM turns a bare URL in running text into a link. The serializer then
// writes that link back as "[https://x](https://x)" — link syntax the user
// never typed, appearing in the file merely because a URL was mentioned.
// That is the stray fragment behind defect D2, and it breaks the R-C2
// round-trip on any document that names a URL. Returning undefined from the
// `url` inline tokenizer leaves those URLs as text; explicit links —
// "[text](url)" and "<url>" — are matched by other tokenizers and still parse.
marked.use({ tokenizer: { url: () => undefined } });

// Allow TipTap-specific attributes through sanitization
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'data-type' || data.attrName === 'data-checked') {
    data.forceKeepAttr = true;
  }
});

export interface ParseOptions {
  /**
   * Read a single newline as a line break rather than as a space. Off for
   * files, whose author chose where the paragraphs are; on for pasted text,
   * where the lines the user copied are the only structure on offer and
   * reflowing them into one line would lose it.
   */
  readonly breaks?: boolean;
}

export function markdownToHtml(markdown: string, options: ParseOptions = {}): string {
  const html = marked.parse(markdown, { async: false, breaks: options.breaks ?? false }) as string;

  // How each table was spelled — padded or hugged columns, the separator's
  // own shape — read from the markdown and pinned to the table it belongs to
  // (#93). It has to happen here: `marked` trims every cell, so by the time
  // this HTML exists the file's spacing is already gone.
  const withTableStyles = attachTableStyles(html, markdown);

  // The checkbox `marked` writes for a GFM task item, rewritten for whichever
  // list holds it (#160).
  const processed = rewriteCheckboxes(withTableStyles);

  // Which of those lists is a task list, in the spelling TipTap reads (#110).
  // It has to happen after the rewrite above and before sanitization, because
  // it is that rewrite's other half: marking the items without marking the
  // list around them leaves an empty `listItem` before every task list.
  const withTaskLists = markTaskLists(processed);

  // Sanitize HTML to prevent XSS from malicious markdown.
  // blob: URIs must be allowed — image-registry.ts creates blob URLs
  // for all image display (both Tauri and Web).
  //
  // `TABLE_STYLE_ATTRIBUTE` widens the allow-list by `data-table-style`, and
  // that is safe only because `attachTableStyles` in `table-style.ts` removes
  // the attribute from every table before writing the detected one. Without
  // that strip, a document carrying its own `data-table-style` in raw HTML
  // would choose how its table is written — the two lines are load-bearing
  // together and they live in different files, so neither may be removed while
  // reading only the other. `decodeTableStyle` validates the value regardless.
  return DOMPurify.sanitize(withTaskLists, {
    ADD_ATTR: ['data-type', 'data-checked', TABLE_STYLE_ATTRIBUTE],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

// ── The two lists a task marker can appear in (#160) ──
//
// GFM puts a task marker in an ordered list as readily as in a bullet one, and
// `marked` writes the same `<input>` for both. This used to be a pair of
// regular expressions over the HTML string, which cannot see what holds the
// item — so a checkbox inside an `<ol>` was rewritten into a task item, and
// `task-list.ts` then refused to mark the `<ol>` around it, deliberately and
// with its reason written down. ProseMirror recovered by opening a task list
// *inside* the ordered item, and `1. [ ] a`⏎`2. [ ] b` came back as
// `1. - [ ] a`⏎`   - [ ] b`: a bullet nobody typed, **the second number gone,
// and two items collapsed into one**.
//
// The rewrite is a DOM pass now, because the decision needs the parent and a
// regular expression over a string does not have one.
//
// ── Why the two branches differ, and why the `<ol>` one writes text ──
//
// A `taskList` renders as a `<ul>`, so marking an `<ol>` would claim a shape
// the serializer cannot honestly write back — that is `task-list.ts`'s
// argument and it still holds. Two other routes were measured on #163 and
// both lose the marker outright: leaving the `<input>` alone writes `1. a`,
// because ProseMirror has no node for one and drops it; and there is no
// schema shape that keeps a checkbox inside an ordered item.
//
// So inside an `<ol>` the marker goes back to being **text**, which is what it
// was in the file before `marked` read it. The document then holds
// `orderedList(listItem(paragraph("[ ] a")))`, both numbers and both items
// survive, and the serializer writes `1. \[ \] a` — two backslashes, because
// turndown escapes `[` and `]` wherever they appear. That is a respelling
// rather than a loss, it renders identically, and the file holds still
// afterwards; it is recorded in R-C2 with its constraint named.

/** Whether this checkbox stands for a ticked item. */
function isChecked(input: Element): boolean {
  return input.hasAttribute('checked');
}

/**
 * `marked` writes `<input> text`, with the space between them belonging to the
 * text. A task item drops both the input and that space, the way the regular
 * expressions here used to with `\s*`; an ordered item keeps the space,
 * because the marker it is being given back ends where the text begins.
 */
function dropLeadingSpace(li: Element): void {
  const first = li.firstChild;
  if (first !== null && first.nodeType === Node.TEXT_NODE) {
    first.textContent = (first.textContent ?? '').replace(/^\s+/, '');
  }
}

export function rewriteCheckboxes(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  // Only a checkbox that is the item's own child, which is the shape a tight
  // list produces. A loose list puts it inside a paragraph instead, and that
  // shape is deliberately not matched here — it is the open member of #160,
  // and reaching it removes an element #104's reasoning rests on.
  const checkboxes = Array.from(container.querySelectorAll('li > input[type="checkbox"]'));
  if (checkboxes.length === 0) return html;

  for (const input of checkboxes) {
    // The selector guarantees the parent is an `<li>`; what holds *that* is
    // the question this pass exists to answer.
    const item = input.parentElement as HTMLElement;
    const list = item.parentElement;

    if (list?.nodeName === 'UL') {
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', isChecked(input) ? 'true' : 'false');
      item.removeChild(input);
      dropLeadingSpace(item);
      continue;
    }

    if (list?.nodeName === 'OL') {
      item.replaceChild(
        container.ownerDocument.createTextNode(isChecked(input) ? '[x]' : '[ ]'),
        input,
      );
    }

    // Anything else — a checkbox in an `<li>` with no list around it, which
    // this pipeline cannot produce — is left exactly as it was.
  }

  return container.innerHTML;
}
