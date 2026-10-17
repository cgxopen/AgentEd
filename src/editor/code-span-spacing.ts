import {
  type DOMParser,
  Fragment,
  type Mark,
  type Node as ProseMirrorNode,
  type Schema,
  type TagParseRule,
} from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';

/**
 * The text of a code span as the file wrote it, white space included (#603).
 *
 * ── What was lost ──
 *
 * Inside a code span white space is content: GitHub draws `a  b` with both
 * spaces. `marked` hands the editor the text of the span as CommonMark reads
 * it, and the ProseMirror DOM parser then normalised it as it normalises
 * prose: a run became one space, a tab a space, the padding of the span went,
 * and a span of spaces only went with its spaces. Measured on the step zero
 * of #603, 109 files of the corpus snapshot were written with code spans
 * cmark-gfm read otherwise after the save.
 *
 * ── The text of the span ──
 *
 * `preserveWhitespace` is read for a node rule alone, and a code span is a
 * mark, so the rule below hands the parser the text of a `code` whose
 * children are all text through `getContent`, which inserts it as it stands.
 * A `code` holding an element is left to the rule of the mark as before.
 *
 * ── The text around it ──
 *
 * The parser still normalises the text beside a span. After a text that ends
 * in white space it drops the leading space of the next text, so `the
 * \`name \` of` lost the space after the span; and it trims the white space
 * at the end of the last text of a block, so a span ending a paragraph lost
 * its trailing padding, and a paragraph holding only a span of spaces lost
 * the span (prosemirror-model 1.25.12, `addTextNode` and `finish`). So the
 * parse is asked where each span ends, through `findPositions`, and what it
 * trimmed is put back from the HTML: the end of the span, with the marks of
 * the span, and the one space after it, with the marks of the text it began.
 * The work is bounded by the spans of the document, each looked at once.
 */

/** The parse rule of a code span whose children are all text: its text as it stands. */
export const codeSpanTextRule: TagParseRule = {
  tag: 'code',
  priority: 60,
  getAttrs: (element) =>
    Array.from(element.childNodes).every((child) => child.nodeType === Node.TEXT_NODE)
      ? null
      : false,
  getContent: (dom, schema) => {
    const text = dom.textContent ?? '';
    return text === '' ? Fragment.empty : Fragment.from(schema.text(text));
  },
};

/** The white space the DOM parser treats as collapsible. */
const COLLAPSIBLE = /[ \t\r\n\f]/;

/** The elements whose first text the parser reads as continuing the line. */
const INLINE_FORMATTING = /^(?:A|B|DEL|EM|I|KBD|MARK|S|STRIKE|STRONG|SUB|SUP|U)$/;

/** A span the parse is asked about: the element, its text, and the point where it starts. */
interface Span {
  readonly element: Element;
  readonly text: string;
  readonly start: { node: globalThis.Node; offset: number; pos?: number };
}

/** The spans whose text the rule above delivers, outside a fenced block. */
function spansOf(container: HTMLElement): Span[] {
  const spans: Span[] = [];
  for (const element of Array.from(container.querySelectorAll('code'))) {
    if (element.closest('pre') !== null || element.parentNode === null) continue;
    if (!Array.from(element.childNodes).every((child) => child.nodeType === Node.TEXT_NODE)) {
      continue;
    }
    // Only a span ending in white space can lose anything to the parse, and
    // every point asked of it is read once per node the parse visits, so a
    // span that cannot is not asked about: the 884 KB changelog of the census
    // opened in 25 s with every span asked, and in 11 s on `main`.
    if (!COLLAPSIBLE.test(element.textContent?.at(-1) ?? '')) continue;
    const parent = element.parentNode;
    const index = Array.prototype.indexOf.call(parent.childNodes, element);
    spans.push({
      element,
      text: element.textContent ?? '',
      start: { node: parent, offset: index },
    });
  }
  return spans;
}

/** The first text after the span on its line, where the parser reads it as continuing it. */
function textAfter(element: Element): string | null {
  const next = element.nextSibling;
  if (next === null) return null;
  if (next.nodeType === Node.TEXT_NODE) return next.nodeValue;
  if (next.nodeType === Node.ELEMENT_NODE && INLINE_FORMATTING.test(next.nodeName)) {
    const walker = next.ownerDocument?.createTreeWalker(next, NodeFilter.SHOW_TEXT);
    return walker?.nextNode()?.nodeValue ?? null;
  }
  return null;
}

/** `marks` without the code mark. */
function withoutCode(marks: readonly Mark[], schema: Schema): readonly Mark[] {
  const code = schema.marks.code;
  return code === undefined ? marks : code.removeFromSet(marks);
}

/**
 * The document `container` parses to, with the white space of its code spans
 * as the HTML holds it.
 */
export function parseKeepingCodeSpacing(
  parser: DOMParser,
  container: HTMLElement,
): ProseMirrorNode {
  const spans = spansOf(container);
  const doc = parser.parse(container, { findPositions: spans.map((span) => span.start) });
  const code = parser.schema.marks.code;
  if (spans.length === 0 || code === undefined) return doc;
  const tr = new Transform(doc);
  // From the last span to the first, so a position read before an insertion
  // is still the position of its span. The start of a span is read rather
  // than its end: the trim at the end of a block comes after the parse has
  // reported positions, and moves an end past the text it trimmed.
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i];
    const start = span.start.pos;
    // A position the normalisation of the parse moved out of a block of text
    // is not one to write at: the span is left as the parse gave it.
    if (start === undefined || start > tr.doc.content.size) continue;
    // A span opening a list item or a cell is read before the parse opens the
    // paragraph it wraps the text in, so its start is just inside that block.
    let $start = tr.doc.resolve(start);
    if (!$start.parent.inlineContent && $start.nodeAfter?.isTextblock) {
      $start = tr.doc.resolve(start + 1);
    }
    if (!$start.parent.inlineContent) continue;
    const first = $start.nodeAfter;
    const text = first?.isText && code.isInSet(first.marks) ? (first.text ?? '') : '';
    let length = 0;
    while (length < text.length && length < span.text.length && text[length] === span.text[length])
      length++;
    const end = $start.pos + length;
    let at = end;
    if (length < span.text.length && length === text.length) {
      const marks = first?.isText ? first.marks : code.create().addToSet($start.marks());
      const tail = span.text.slice(length);
      tr.insert(end, parser.schema.text(tail, marks));
      at = end + tail.length;
    }
    const after = textAfter(span.element);
    if (after === null || !COLLAPSIBLE.test(after[0] ?? '')) continue;
    if (!COLLAPSIBLE.test(span.text.at(-1) ?? '')) continue;
    const $at = tr.doc.resolve(at);
    const next = $at.nodeAfter;
    if (next?.isText && COLLAPSIBLE.test(next.text?.[0] ?? '')) continue;
    const marks =
      next?.isText && !code.isInSet(next.marks)
        ? next.marks
        : withoutCode($at.marks(), parser.schema);
    tr.insert(at, parser.schema.text(' ', marks));
  }
  return tr.doc;
}
