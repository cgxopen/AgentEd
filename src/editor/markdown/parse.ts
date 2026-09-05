import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE, blankMarkerAttribute } from './blockquote-spacing';
import { attachListSpacing, LIST_SPACING_ATTRIBUTE } from './list-spacing';
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

// How each blockquote spelled its blank lines, written onto the quote it
// belongs to (#199). Two spellings of one blank line — a bare marker and a
// marker with a space — read the same and are different bytes, and by the
// time this HTML exists they are byte-identical, so the file has to be asked
// while it is still being read.
//
// **A renderer rather than a pass afterwards, and that is the point.** The
// other two properties read off the file this way — a table's columns and a
// list's spacing — are detected into an array and paired with the parsed HTML
// by document order, which refuses silently when the counts disagree (#200).
// A blockquote needs none of it: `marked` hands this function the token for
// the quote it is rendering, so the bytes and the element are the same thing
// and there is nothing to pair. Nesting falls out for free — an inner quote
// is a second call whose `raw` is the inner source, outer marker already
// stripped.
//
// The output is otherwise turndown's own: `<blockquote>` newline body
// `</blockquote>` newline, matched exactly so nothing but the attribute
// changes.
marked.use({
  renderer: {
    blockquote(token) {
      const raw = typeof token.raw === 'string' ? token.raw : '';
      const body = this.parser.parse(token.tokens ?? []);
      return `<blockquote${blankMarkerAttribute(raw)}>\n${body}</blockquote>\n`;
    },
  },
});

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

  // How each list was spaced — loose or tight — read from the markdown for
  // the same reason and pinned to the list it belongs to (#28). The `<p>`
  // wrappers `marked` writes are still here, but they answer CommonMark's
  // question rather than the file's; see `list-spacing.ts`.
  const withListSpacing = attachListSpacing(withTableStyles, markdown);

  // The checkbox `marked` writes for a GFM task item, rewritten for whichever
  // list holds it (#160).
  const processed = rewriteCheckboxes(withListSpacing);

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
    ADD_ATTR: [
      'data-type',
      'data-checked',
      TABLE_STYLE_ATTRIBUTE,
      LIST_SPACING_ATTRIBUTE,
      BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE,
    ],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

// ── The two lists a task marker can appear in, and the two spellings (#160) ──
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
// ── The two spellings, and the one that used to be missed ──
//
// The same marker is written two ways depending on how the list is spaced:
// `<li><input> a` for a tight list, `<li><p><input> a</p>` for a loose one —
// blank lines between the items, which is how a to-do list is often written
// because it reads better. Only the tight spelling was matched, so a loose
// task list reached ProseMirror with an `<input>` no schema node can hold and
// **lost every marker it had**: `- [ ] a`⏎⏎`- [ ] b` was written `- a`⏎`- b`,
// sixteen bytes to seven, the words kept and the checkboxes gone. What is left
// now is the blank line, which is the loose-list exception R-C2 records.
//
// **That widening has a cost outside this file**, and it is written down where
// it lands: removing the `<input>` is what lets a task item be *blank* for
// turndown, which is the premise #104 rests on. See the amendment in
// `empty-fence.test.ts` for the rule, for why the branch is correct where it
// is now reached, and for what cannot reach it.
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
 *
 * The element passed is whatever held the checkbox — the item itself in a
 * tight list, the item's first paragraph in a loose one — because that is
 * where the space is.
 */
function dropLeadingSpace(holder: Element): void {
  const first = holder.firstChild;
  if (first !== null && first.nodeType === Node.TEXT_NODE) {
    first.textContent = (first.textContent ?? '').replace(/^\s+/, '');
  }
}

export function rewriteCheckboxes(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;

  // The two shapes `marked` writes a task marker in. A **tight** list puts the
  // checkbox directly in the item; a **loose** one — blank lines between the
  // items — wraps every item body in a `<p>`, and the checkbox goes inside it.
  // It is the same marker in the same position of the same item, so both are
  // matched. Only the tight one used to be, and a loose task list therefore
  // arrived at ProseMirror with an `<input>` no schema node can hold: every
  // marker was dropped, `- [ ] a`⏎⏎`- [ ] b` saving as `- a`⏎`- b`.
  const checkboxes = Array.from(
    container.querySelectorAll(
      'li > input[type="checkbox"], li > p:first-child > input[type="checkbox"]',
    ),
  );
  if (checkboxes.length === 0) return html;

  for (const input of checkboxes) {
    // The selector guarantees the parent is an `<li>` or the item's first
    // `<p>`; the marker belongs to the item either way, and it is what holds
    // *that* which this pass exists to answer.
    const holder = input.parentElement as HTMLElement;
    const item = (holder.nodeName === 'LI' ? holder : holder.parentElement) as HTMLElement | null;
    const list = item?.parentElement;

    if (item && list?.nodeName === 'UL') {
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', isChecked(input) ? 'true' : 'false');
      holder.removeChild(input);
      dropLeadingSpace(holder);
      continue;
    }

    if (item && list?.nodeName === 'OL') {
      holder.replaceChild(
        container.ownerDocument.createTextNode(isChecked(input) ? '[x]' : '[ ]'),
        input,
      );
    }

    // Anything else — a checkbox in an `<li>` with no list around it, which
    // this pipeline cannot produce — is left exactly as it was.
  }

  return container.innerHTML;
}
