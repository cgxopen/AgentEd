import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { blankMarkerAttribute } from './blockquote-spacing';
import { commentCarrier } from './comment-spelling';
import {
  encodeIndents,
  FOOTNOTE_BLANK_LINE_ATTRIBUTE,
  FOOTNOTE_DEFINITION,
  FOOTNOTE_DEFINITION_ATTRIBUTE,
  FOOTNOTE_INDENTS_ATTRIBUTE,
  splitDefinition,
} from './footnote';
import { stampImageSources } from './image-spelling';
import { listSpacingAttribute } from './list-spacing';
import { stampTableSource } from './table-html-source';
import { tableStyleAttribute } from './table-style';
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
// list's spacing — used to be detected into an array and paired with the
// parsed HTML by document order, which refused silently when the counts
// disagreed; #200 moved both of them here, so all three now take this route.
// `marked` hands this function the token for the quote it is rendering, so
// the bytes and the element are the same thing and there is nothing to pair.
// Nesting falls out for free — an inner quote is a second call whose `raw` is
// the inner source, outer marker already stripped.
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

// How the file spelled each image written as inline HTML, written onto the tag
// it belongs to (#27).
//
// **The same route as the blockquote above, for the same reason.** An `<img>`
// the file wrote as HTML arrives as an `html` token — measured, block when it
// is alone on a line and inline when it sits in a paragraph, and `raw` is the
// tag bytes either way — so the renderer is looking at the file while the
// element is being built and there is nothing to pair. A markdown image
// arrives as an `image` token instead and reaches a different renderer, which
// is how the two spellings are told apart without inspecting anything.
//
// `token.text` is what the default renderer returns, so the output is
// otherwise `marked`'s own and nothing but the attribute changes. A token
// carrying no image is returned unchanged, which is every other piece of raw
// HTML in every document.
//
// A block token that is one whole `<table>` gets its bytes stamped onto the
// table the same way first (#283), so a table the file wrote as HTML can be
// written back as HTML while it is unedited. See `table-html-source.ts`. A GFM
// table arrives as a `table` token and reaches the renderer below instead,
// which is how the two are told apart. The image stamp still runs over the
// stamped table, so an image inside one keeps its own spelling if the table is
// edited and written as GFM.
marked.use({
  renderer: {
    html(token) {
      // A token that is exactly one comment becomes an inert carrier holding
      // its bytes (#245), because DOMPurify removes a comment node and nothing
      // downstream can put it back. Everything else an `html` token can hold
      // goes on to the image stamp exactly as before.
      const carrier = commentCarrier(token.text, token.block);
      if (carrier !== null) return carrier;
      const table = token.block ? stampTableSource(token.text, token.raw) : null;
      return stampImageSources(table ?? token.text);
    },
  },
});

// How each list was spaced — loose or tight — written onto the list it belongs
// to (#28), from the token `marked` is rendering (#200).
//
// **The same route as the two above, and it replaces a pairing.** This used to
// be a pass over the finished HTML that detected every list of the document
// into an array and matched it to `querySelectorAll('ul, ol')` by document
// order, writing nothing at all when the counts disagreed — silently, and for
// the whole document rather than the one list it could not place. A list the
// file wrote as raw HTML arrives as an `html` token and so is invisible to the
// walk while the selector finds it, which is how an ordinary `<details>` block
// cost every loose list in its file the spacing R-C2 promises. The token
// carries the `raw` of each of its own items, so there is nothing to pair.
//
// This restates `marked`'s own list renderer, because there is no way to call
// it and add one attribute; a nested list reaches it as a second call, through
// `listitem` below. `list-spacing.test.ts` renders through a pristine `Marked`
// and asserts byte-identical output wherever the attribute is absent, so a
// release that changes the shape fails there rather than in a document.
marked.use({
  renderer: {
    list(token) {
      const spacing = listSpacingAttribute(token.items);
      let body = '';
      for (const item of token.items) body += this.listitem(item);
      const tag = token.ordered ? 'ol' : 'ul';
      // `marked` writes `start` only when it is not 1, and the attribute order
      // is its own: an ordered list that names its start keeps that spelling.
      const start = token.ordered && token.start !== 1 ? ` start="${token.start}"` : '';
      return `<${tag}${start}${spacing}>\n${body}</${tag}>\n`;
    },
  },
});

// How each table was spelled — padded or hugged columns, the separator's own
// shape — written onto the table it belongs to (#93), from the token `marked`
// is rendering (#200).
//
// **The same move as the list above, and it repairs one case more.** The pass
// it replaces scanned raw lines for table blocks, and a table inside a
// blockquote has lines that open with a quote marker — so the scan found none
// where `marked` found a table, the counts disagreed, and every table in that
// document fell back to the default spelling. That is plain markdown with no
// raw HTML in it. The token `raw` is the table with the quote markers already
// stripped, which is why the reading is now the correct one there.
//
// This restates `marked`'s own table renderer for the same reason as the list,
// and `table-style.test.ts` pins it against a pristine `Marked` the same way.
marked.use({
  renderer: {
    table(token) {
      let header = '';
      for (const cell of token.header) header += this.tablecell(cell);
      let body = '';
      for (const row of token.rows) {
        let cells = '';
        for (const cell of row) cells += this.tablecell(cell);
        body += this.tablerow({ text: cells });
      }
      const rows = body ? `<tbody>${body}</tbody>` : '';
      const style = tableStyleAttribute(typeof token.raw === 'string' ? token.raw : '');
      return `<table${style}>\n<thead>\n${this.tablerow({ text: header })}</thead>\n${rows}</table>\n`;
    },
  },
});

// ── An alt text holding a double quote (#232, member 1) ──
//
// `marked` writes the `title` of an image escaped and the `alt` raw — its own
// renderer is `alt="${text}"` beside `title="${escape(title)}"`, one line apart
// — so `![say "hi"](i.png)` was emitted as `alt="say "hi""`, which is not an
// attribute any parser can read. DOMPurify kept `say` and the rest of the words
// were gone before the document existed. Saved as `![say](i.png)`: a loss of
// text the user wrote, on the ordinary path, at the parser.
//
// **Only the double quote was broken**, measured: an apostrophe, an ampersand,
// an angle bracket and a backslash in an alt all survive untouched. The repair
// is nonetheless the whole escape rather than that one character, because the
// question is not *which characters break today* but *which values can be
// written into an HTML attribute*, and `title` already had the answer.
//
// ── Why the renderer rather than a pass afterwards ──
//
// By the time the HTML string exists the alt is already ambiguous — `say "hi"`
// and `say` are the same bytes to a parser — so nothing downstream can recover
// it. It has to be written correctly where it is written, which is here. The
// same route `blockquote-spacing.ts` uses for #199 and `image-spelling.ts` for
// #229, and for the same reason: `marked` hands the renderer the token.
//
// ── What is copied from the library, and how drift is caught ──
//
// This restates two small pieces of `marked`'s own renderer, because there is
// no way to call it and adjust one attribute. `escapeForAttribute` is its
// `escape` with `encode` false, the exact function it already applies to
// `title`; `cleanImageUrl` is its `cleanUrl`, and the `null` branch that turns
// an unencodable address into escaped text is kept because dropping it would
// change what a malformed address does.
//
// Restating a library is how a silent divergence starts, so it is not trusted:
// `image-alt.test.ts` renders a fixture through a pristine `Marked` and asserts
// that for every alt holding none of the escaped characters this produces
// **byte-identical** output. A release that changes the shape fails there
// rather than in a document.
const MARKED_ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** `marked`'s own attribute escape — an `&` that already opens an entity is left. */
const MARKED_ESCAPE_RE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;

function escapeForAttribute(text: string): string {
  return text.replace(MARKED_ESCAPE_RE, (ch) => MARKED_ATTRIBUTE_ESCAPES[ch] ?? ch);
}

/** `marked`'s own `cleanUrl`: `null` where the address cannot be encoded. */
function cleanImageUrl(href: string): string | null {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

marked.use({
  renderer: {
    image(token) {
      // The alt as plain text, the way the default builds it — inline markup
      // inside an alt is flattened, because an attribute cannot hold elements.
      const text = token.tokens
        ? this.parser.parseInline(token.tokens, this.parser.textRenderer)
        : token.text;
      const href = cleanImageUrl(token.href);
      if (href === null) return escapeForAttribute(text);
      const title = token.title ? ` title="${escapeForAttribute(token.title)}"` : '';
      return `<img src="${href}" alt="${escapeForAttribute(text)}"${title}>`;
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

// ── Footnote definitions, taken before `marked` can read them as links (#408) ──
//
// **A block extension is tried before `marked` tries its own block
// tokenizers**, which is the whole of the ordering and why nothing is
// reordered here. Measured at the lexer: `[^a]: https://example.com/schema`
// puts `^a` in the links map today and the line is gone from the token
// stream; with this registered the links map is empty and the definition is a
// token. `[docs]: https://example.com/d` is unaffected on both sides - the
// pattern matches only `[^`, so a reference-style link definition is consumed
// exactly as it always was, which #408 pins as a regression row.
//
// **The continuation is consumed here rather than left behind.** Measured: a
// tokenizer that takes only the first line leaves `    second line` for
// `marked`, which reads an indented line as a **code block** - so the repair
// would have invented a fenced block where the file had a sentence.
marked.use({
  extensions: [
    {
      name: 'footnoteDefinition',
      level: 'block',
      start(src: string) {
        const at = src.match(/\n\[\^/)?.index;
        return at === undefined ? undefined : at + 1;
      },
      tokenizer(src: string) {
        const match = FOOTNOTE_DEFINITION.exec(src);
        if (!match) return undefined;
        return { type: 'footnoteDefinition', raw: match[0], tokens: [] } as never;
      },
      renderer(token: unknown) {
        const raw = (token as { raw: string }).raw;
        // `marked` hands the definition the blank line under it, so the gap the
        // file spelled is readable here and nowhere later (#418). It is taken
        // off the bytes before they are split, or the run would gain an empty
        // continuation line, and travels on the element instead.
        const followedByBlankLine = raw.endsWith('\n\n');
        const gap = followedByBlankLine ? ` ${FOOTNOTE_BLANK_LINE_ATTRIBUTE}` : '';
        const { lines, indents } = splitDefinition(followedByBlankLine ? raw.slice(0, -1) : raw);
        // A hard break per continuation, because the content is editable and a
        // newline inside inline content is a soft break the serializer
        // collapses to a space. The indentation cannot live in the text for
        // the same reason, so it travels on the element.
        const body = lines.map(escapeHtmlText).join('<br>');
        return `<div ${FOOTNOTE_DEFINITION_ATTRIBUTE}${gap} ${FOOTNOTE_INDENTS_ATTRIBUTE}="${encodeIndents(indents)}">${body}</div>`;
      },
    },
  ],
});

/** The three characters that could end the element this text is written into. */
function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function markdownToHtml(markdown: string, options: ParseOptions = {}): string {
  const html = marked.parse(markdown, { async: false, breaks: options.breaks ?? false }) as string;

  // A table's spelling and a list's spacing are already on the elements that
  // carry them: both are written by the renderers above, from the token
  // `marked` hands them, rather than by a pass over this string (#200).

  // The checkbox `marked` writes for a GFM task item, rewritten for whichever
  // list holds it (#160).
  const processed = rewriteCheckboxes(html);

  // Which of those lists is a task list, in the spelling TipTap reads (#110).
  // It has to happen after the rewrite above and before sanitization, because
  // it is that rewrite's other half: marking the items without marking the
  // list around them leaves an empty `listItem` before every task list.
  const withTaskLists = markTaskLists(processed);

  // Sanitize HTML to prevent XSS from malicious markdown.
  // blob: URIs must be allowed — image-registry.ts creates blob URLs
  // for all image display (both Tauri and Web).
  //
  // ── No `data-*` attribute is listed, and that is measured ──
  //
  // DOMPurify keeps every `data-*` attribute by itself, because
  // `ALLOW_DATA_ATTR` defaults to true; `comment-spelling.test.ts` pins that
  // default, so a release that changed it fails there rather than in a
  // document. Six such entries used to stand in `ADD_ATTR` here — `data-type`,
  // `data-checked`, the table style, the list spacing, the blockquote blank
  // marker and the image source — and none of them did anything: removed
  // together on #283, the suite moved not one test. They were lines that
  // looked load-bearing and were not, the reason #245 gave for leaving
  // `data-comment` out, and the table source from #283 is left out for the same
  // reason. What follows is about what a document can *say* with each
  // attribute, which is the question that was always the real one.
  //
  // **The table style and the list spacing: the value is bounded** (#200).
  // Until the renderers above existed, the two passes over this string removed
  // both attributes from every table and list before writing the detected
  // ones, so a document carrying its own could not reach the serializer at
  // all; the passes are gone and so is the strip. What a document can do now
  // is mostly what the attribute means anyway: a list the file wrote as **raw
  // HTML** keeps the spacing the file gave it, and a raw HTML table keeps the
  // spelling it is written in once it is edited — unedited, it is written back
  // as its own bytes (#283). A markdown table and a markdown list cannot be
  // reached that way, because both get their value written at render time from
  // their own bytes.
  //
  // **One element it can reach besides its own**, and it is named here rather
  // than left to be discovered: a table the *user created* has no spelling, so
  // `styleFor` in `serialize.ts` gives it the spelling of the first table in
  // the document that has one — the rule from #93 that keeps a document from
  // being spelled two ways — and a raw HTML table carrying its own attribute
  // can be that first table. What it can say there is bounded by
  // `decodeTableStyle`: a separator cell is dashes, colons and spaces or the
  // whole style is refused, and a width is a small whole number. So the reach
  // is one new table, and what it costs is column padding. `data-loose` has no
  // such fallback — it is read as the literal `true` or not at all, on the list
  // carrying it.
  //
  // **The image source and the table source: safe by construction** (#27,
  // #283). Each value is `encodeURIComponent` output, so it holds no `<`, `>`,
  // `&` or `"` and cannot end the attribute or open an element, and its
  // decoder refuses anything that is not one image tag or one whole table. A
  // document carrying its own `data-html-source` therefore chooses at most how
  // *its own* image is written back, which is what the attribute means anyway.
  // A document carrying its own `data-table-html-source` chooses nothing: the
  // renderer stamps the file's bytes ahead of it, and an HTML parser keeps the
  // first of two attributes with one name.
  return DOMPurify.sanitize(withTaskLists, {
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
