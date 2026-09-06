/**
 * How an image was spelled in the file it came from (#27).
 *
 * Markdown has one image syntax, `![alt](path)`, and it carries a source and
 * an alt text and nothing else. A size has to be written as inline HTML —
 * `<img src="a.png" alt="x" width="600">` — which CommonMark admits and every
 * mainstream renderer draws. R-C2 records that as a stated position rather
 * than as an exception: it is something AgentEd chooses to write.
 *
 * Which makes *how did the file spell this image* a property of the image, the
 * third of its kind in this repository after a table's columns (#93) and a
 * list's spacing (#28).
 *
 * ── Read from the renderer, not paired afterwards ──
 *
 * Those two detect into an array and pair it with the parsed HTML by document
 * order, which refuses silently when the counts disagree (#200). This needs
 * none of it, for the reason `blockquote-spacing.ts` gives (#213): `marked`
 * hands a renderer the token it is rendering, and that token carries the `raw`
 * source of **that** element. Measured here, at both levels — an `<img>` alone
 * on a line arrives as a block `html` token and one inside a paragraph as an
 * inline `html` token, and `raw` is the tag bytes either way. A markdown image
 * arrives as an `image` token instead, so the two are told apart by which
 * renderer is called rather than by inspecting anything.
 *
 * ── Why the bytes and not the width ──
 *
 * The obvious carrier is the width and the height, and it was measured before
 * it was rejected. Eleven spellings of one image were compared against what a
 * canonical `<img src alt width height>` rewrite produces: **three matched and
 * eight did not** — unquoted attributes, single quotes, a self-closing slash, a
 * different attribute order, `style`, `title`, upper-case names, an absent
 * `alt`. So a canonical rewrite is byte-for-byte only for the form AgentEd
 * would have written itself, and every spelling written by a person changes.
 * That is the failure the decision on #27 rejected — *the width leaves a file
 * nobody edited* — moved from `width` to `style` and to quoting.
 *
 * So the node carries **the source bytes of the tag**, and a resize edits the
 * width inside those bytes rather than replacing them. An image nobody touched
 * is therefore written back exactly as the file spelled it, whatever it spelled
 * — which is the acceptance criterion #27 puts above every other — and a
 * resized one keeps its `style`, its `title` and its quoting, because the only
 * thing that moved is the number the user dragged.
 *
 * ── The bytes are carried encoded, and that is not decoration ──
 *
 * The value travels through an HTML attribute in a string DOMPurify then
 * parses, so raw source bytes in it would be an injection route. They are
 * carried `encodeURIComponent`-encoded, which yields only letters, digits and
 * `-_.!~*'()` plus percent escapes: no `<`, no `>`, no `&` and no `"` can
 * appear in the value at all, so it cannot end the attribute or open an
 * element whatever the file contained. That is a property of the encoding
 * rather than of careful escaping, and `image-spelling.test.ts` asserts it
 * against tag bytes built to break a quoted attribute.
 *
 * What the file carried is still written back on save, including an attribute
 * DOMPurify refuses to render — an `onerror`, say. It never runs: the sanitizer
 * removes it from the document on the way in, and nothing here ever assigns
 * these bytes as `innerHTML`. Writing them back is what a round-trip promise
 * means; the alternative is silently editing a document nobody edited. It is
 * recorded on #27 as a position rather than left to be discovered.
 */

/** Set on an `<img>` the file spelled as inline HTML, carrying its bytes. */
export const IMAGE_HTML_SOURCE_ATTRIBUTE = 'data-html-source';

/** The tag bytes, in a form that cannot carry markup. See the note above. */
export function encodeHtmlSource(raw: string): string {
  return encodeURIComponent(raw);
}

/**
 * The tag bytes back, or `null` when the value is not something this module
 * wrote.
 *
 * A malformed percent escape throws in `decodeURIComponent`, and a value that
 * did not come from `encodeHtmlSource` can be anything — it reaches here from
 * an attribute in the parsed document, which a hand-written `data-html-source`
 * in a user file could also have set. Answering `null` puts such an image on
 * the markdown path, which is the shape it would have had with no attribute at
 * all; throwing would take the document down on open.
 */
export function decodeHtmlSource(value: string | null): string | null {
  if (value === null || value === '') return null;
  try {
    const decoded = decodeURIComponent(value);
    return isSingleImageTag(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

// ── Finding the tags in a raw html token ──

/**
 * The `<img …>` tags of `raw`, as `[start, end)` pairs.
 *
 * One left-to-right pass with an explicit quote state, rather than a regular
 * expression, and the reason is that both obvious expressions are wrong.
 * `<img[^>]*>` stops at the first `>`, so it cuts a tag whose alt or title text
 * holds one — `alt="a > b"` — in half. The expression that reads quotes
 * correctly needs nested quantifiers, which backtrack, and the input here is a
 * user document. This visits each character exactly once and can do neither.
 */
export function imageTagSpans(raw: string): ReadonlyArray<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  let i = 0;
  while (i < raw.length) {
    const open = raw.indexOf('<', i);
    if (open === -1) break;
    if (!startsImageTag(raw, open)) {
      i = open + 1;
      continue;
    }
    const end = tagEnd(raw, open);
    if (end === -1) break;
    spans.push([open, end]);
    i = end;
  }
  return spans;
}

/** Whether `<` at `at` opens an `img` tag — the name, then a boundary. */
function startsImageTag(raw: string, at: number): boolean {
  if (raw.slice(at + 1, at + 4).toLowerCase() !== 'img') return false;
  const after = raw[at + 4];
  return after === undefined || after === '>' || after === '/' || /\s/.test(after);
}

/**
 * One past the `>` that ends the tag opening at `open`, or `-1` when the input
 * ends first. Quoted attribute values are skipped whole, so a `>` inside one
 * does not end the tag.
 */
function tagEnd(raw: string, open: number): number {
  let i = open + 1;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"' || ch === "'") {
      const close = raw.indexOf(ch, i + 1);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }
    if (ch === '>') return i + 1;
    i += 1;
  }
  return -1;
}

/** Whether `raw` is exactly one `<img>` tag and nothing else. */
function isSingleImageTag(raw: string): boolean {
  const spans = imageTagSpans(raw);
  return spans.length === 1 && spans[0][0] === 0 && spans[0][1] === raw.length;
}

// ── Reading and writing one attribute inside those bytes ──

interface AttributeSpan {
  /** Where the attribute starts, including the whitespace in front of it. */
  readonly start: number;
  /** One past the attribute. */
  readonly end: number;
  /** The value as the file wrote it, unquoted; `null` for a bare attribute. */
  readonly value: string | null;
  /** Where the value itself sits, quotes excluded. */
  readonly valueStart: number;
  readonly valueEnd: number;
}

/**
 * Walk the attributes of the tag `tag`, calling `visit` with each.
 *
 * The loop is bounded by the length of the tag and every branch advances `i`,
 * which is asserted by the guard at the bottom: a pass that failed to move
 * would throw rather than spin on a document.
 */
function eachAttribute(tag: string, visit: (name: string, span: AttributeSpan) => void): void {
  // Past `<img`.
  let i = 4;
  while (i < tag.length) {
    const before = i;
    while (i < tag.length && /\s/.test(tag[i])) i += 1;
    const nameStart = i;
    while (i < tag.length && !/[\s=/>]/.test(tag[i])) i += 1;
    if (i === nameStart) {
      // `/`, `>` or the end — no attribute here, so nothing else can follow.
      break;
    }
    const name = tag.slice(nameStart, i);
    const afterName = i;
    while (i < tag.length && /\s/.test(tag[i])) i += 1;
    if (tag[i] !== '=') {
      visit(name, {
        start: before,
        end: afterName,
        value: null,
        valueStart: afterName,
        valueEnd: afterName,
      });
      i = afterName;
      continue;
    }
    i += 1;
    while (i < tag.length && /\s/.test(tag[i])) i += 1;
    const quote = tag[i];
    if (quote === '"' || quote === "'") {
      const close = tag.indexOf(quote, i + 1);
      if (close === -1) break;
      visit(name, {
        start: before,
        end: close + 1,
        value: tag.slice(i + 1, close),
        valueStart: i + 1,
        valueEnd: close,
      });
      i = close + 1;
    } else {
      const valueStart = i;
      while (i < tag.length && !/[\s>]/.test(tag[i])) i += 1;
      visit(name, {
        start: before,
        end: i,
        value: tag.slice(valueStart, i),
        valueStart,
        valueEnd: i,
      });
    }
    /* c8 ignore next 6 -- every branch above advances `i`; this names the
       failure rather than spinning if one ever stops. */
    if (i <= before) {
      throw new Error(
        'image-spelling: the attribute scan failed to advance, which would spin on a document (#27)',
      );
    }
  }
}

/** The value of `name` in `tag` as the file wrote it, or `null` when absent. */
export function readTagAttribute(tag: string, name: string): string | null {
  let found: string | null = null;
  const wanted = name.toLowerCase();
  eachAttribute(tag, (attribute, span) => {
    if (found === null && attribute.toLowerCase() === wanted) found = span.value;
  });
  return found;
}

/** Where `name` sits in `tag`, or `null` when the tag does not carry it. */
function findAttribute(tag: string, name: string): AttributeSpan | null {
  let found: AttributeSpan | null = null;
  const wanted = name.toLowerCase();
  eachAttribute(tag, (attribute, span) => {
    if (found === null && attribute.toLowerCase() === wanted) found = span;
  });
  return found;
}

/**
 * `tag` with `name` set to `value`, or removed when `value` is `null`.
 *
 * **Identity is the property this exists for.** Setting an attribute to the
 * bytes it already holds returns the input unchanged — not an equal string
 * rebuilt from parsed parts, the input — so an image whose size nobody moved
 * is written back exactly as the file spelled it, quoting, attribute order and
 * everything else included. `image-spelling.test.ts` asserts that over the
 * eleven spellings the decision on #27 was measured against.
 */
export function setTagAttribute(tag: string, name: string, value: string | null): string {
  const existing = findAttribute(tag, name);

  if (existing === null) {
    if (value === null) return tag;
    const at = insertionPoint(tag);
    return `${tag.slice(0, at)} ${name}="${value}"${tag.slice(at)}`;
  }

  if (value === null) {
    return tag.slice(0, existing.start) + tag.slice(existing.end);
  }

  // Untouched. Returned before anything is rebuilt, which is what makes an
  // unchanged size a byte-for-byte identity rather than a re-spelling.
  if (existing.value === value) return tag;

  // A bare attribute — `<img … width>` — has nowhere to put a value, so the
  // whole attribute is rewritten. A valued one keeps its own quoting.
  if (existing.value === null) {
    return `${tag.slice(0, existing.start)} ${name}="${value}"${tag.slice(existing.end)}`;
  }
  return tag.slice(0, existing.valueStart) + value + tag.slice(existing.valueEnd);
}

/**
 * Where a new attribute goes: before the `>`, and before a self-closing `/`
 * with it, so `<img … />` stays `<img … x="1" />` rather than gaining an
 * attribute after the slash where no parser would read it.
 */
function insertionPoint(tag: string): number {
  let i = tag.length - 1;
  while (i > 0 && /[\s>/]/.test(tag[i])) i -= 1;
  return i + 1;
}

// ── The stamp the parser writes ──

/**
 * `html`, with every `<img>` in it carrying its own source bytes.
 *
 * Called with the text of a `marked` html token, which is the file bytes for
 * that element. Each tag is stamped with **itself**, so a token holding more
 * than one image gives each of them its own spelling and no arithmetic pairs
 * them.
 *
 * A tag that already carries the attribute is left alone: the value would be
 * the file's own, and this pass has no better answer than the one already
 * there.
 */
export function stampImageSources(html: string): string {
  const spans = imageTagSpans(html);
  if (spans.length === 0) return html;

  const out: string[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    const tag = html.slice(start, end);
    out.push(html.slice(cursor, start));
    out.push(
      findAttribute(tag, IMAGE_HTML_SOURCE_ATTRIBUTE) !== null
        ? tag
        : setTagAttribute(tag, IMAGE_HTML_SOURCE_ATTRIBUTE, encodeHtmlSource(tag)),
    );
    cursor = end;
  }
  out.push(html.slice(cursor));
  return out.join('');
}

// ── What the serializer asks ──

/** A size in pixels, or `null` where the image carries none. */
export interface ImageSize {
  readonly width: number | null;
  readonly height: number | null;
}

/** A positive whole number of pixels, or `null` for anything else. */
export function pixelValue(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  return value > 0 ? value : null;
}

/**
 * The bytes to write for an image, given how the file spelled it and the size
 * it carries now.
 *
 * Three answers, and the first two are the whole of decision 1 on #27:
 *
 *  - **The file spelled it as HTML** — the source bytes, with `width` and
 *    `height` set to the size the node holds now. Unchanged, that is the
 *    identity above, so an untouched image writes its own bytes back. A reset
 *    removes both, which is what decision 4 asks for: an image that was HTML
 *    stays HTML with the size attributes gone.
 *  - **The file spelled it as markdown and it carries no size** — the markdown
 *    form. This is every image in every document that has never been resized,
 *    and it is why this feature changes no bytes on its own.
 *  - **The file spelled it as markdown and it now carries a size** — the
 *    canonical HTML form. The user resized it; this is the one case in which
 *    AgentEd writes HTML into a document that had none, and R-C2 states it.
 */
/**
 * Set or clear one size attribute inside the bytes the file used.
 *
 * **A width AgentEd cannot express is spelling, not size.** `width="50%"` and
 * `width="auto"` are widths a markdown renderer honours and this editor has no
 * handle for: `pixelValue` reads them as no size, so the node carries none, and
 * clearing on that basis would delete a number out of a file nobody edited —
 * the exact failure decision 1 on #27 rejected. So a clear removes a size only
 * where the file wrote one in pixels, which is the only kind a reset can be
 * undoing. Setting is unconditional, because a set means the user dragged.
 */
function resize(tag: string, name: string, value: string | null): string {
  if (value === null && pixelValue(readTagAttribute(tag, name)) === null) return tag;
  return setTagAttribute(tag, name, value);
}

export function imageMarkup(
  htmlSource: string | null,
  alt: string,
  src: string,
  size: ImageSize,
): string {
  const width = size.width === null ? null : String(size.width);
  const height = size.height === null ? null : String(size.height);

  if (htmlSource !== null) {
    const withWidth = resize(htmlSource, 'width', width);
    return resize(withWidth, 'height', height);
  }

  if (width === null && height === null) return `![${alt}](${src})`;

  const canonical = `<img src="${src}" alt="${alt}">`;
  const withWidth = setTagAttribute(canonical, 'width', width);
  return setTagAttribute(withWidth, 'height', height);
}
