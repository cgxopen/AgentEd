/**
 * A slice of `index.html`, taken as a whole element rather than as the text
 * between two strings.
 *
 * **Why it exists.** Two test files mounted the indicator row by slicing from
 * `<div id="header-indicators">` to the first `</div>` after it. That is the
 * whole element only while the element has no element of the same kind inside
 * it — and #332 put one there, a frame around the run of counts. The slice then
 * ended at the inner close tag, the badges after it were never mounted, and ten
 * rows failed on a null element rather than on the thing they were about.
 *
 * So the end is found by counting: an opening tag of the same name pushes the
 * depth up, a closing one brings it down, and the slice ends where the depth
 * returns to zero. Self-closing tags and `<br>` are not counted, because a tag
 * that never closes cannot raise the depth.
 *
 * **Not a parser.** It reads tag names, nothing else: it does not know about
 * comments, `<script>` or attribute values holding what looks like a tag, and
 * `index.html` holds none of those inside the elements it is used on. Where it
 * cannot find a balanced element it throws, rather than returning a shorter
 * string that a test would then mount and misread.
 */

/** The whole `<tag id="…">…</tag>` element that starts at `openTag`. */
export function shippedElement(page: string, openTag: string): string {
  const start = page.indexOf(openTag);
  if (start < 0) throw new Error(`index.html no longer has ${openTag}`);
  const name = /^<([a-z][a-z0-9-]*)/i.exec(openTag)?.[1];
  if (name === undefined) throw new Error(`${openTag} does not begin with a tag name`);

  const tags = new RegExp(`<${name}\\b[^>]*>|</${name}>`, 'gi');
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(page); match !== null; match = tags.exec(page)) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return page.slice(start, match.index + match[0].length);
    } else if (!match[0].endsWith('/>')) {
      depth += 1;
    }
  }
  throw new Error(`${openTag} is never closed in index.html`);
}
