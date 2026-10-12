/**
 * Reference links and their definitions, kept as the file wrote them (#570,
 * owner decisions R1 to R4 and E1 to E5 on #570, comment 6124134681).
 *
 * `marked` reads a definition, `[docs]: https://example.com`, into the
 * `links` map of its token list and emits no token for it, so nothing of it
 * reached a renderer: an unedited save wrote every reference link inline and
 * removed every definition, in 1188 of 8706 files measured on the step zero.
 *
 * ── A definition is a node, a link knows its spelling ──
 *
 * `parse.ts` reads each definition with the `def` tokenizer of `marked`
 * itself, so the links resolve as before, and draws it as the node of #408:
 * the lines the file wrote, editable, written back line by line (R1). Its
 * first line keeps the indentation the file gave it on the element, where a
 * footnote definition has none.
 *
 * Each link and image the file wrote as a reference carries its spelling,
 * full, collapsed or shortcut, and its label as written, on the mark, as #562
 * carries the delimiter of a title.
 *
 * ── Resolved at save, against the definitions as they stand ──
 *
 * A link is written as its reference whenever its label names a definition in
 * the document at save (E4): the definitions are read again from their nodes
 * by the tokenizer of `marked`, labels folded as `marked` folds them, so one
 * edited into something that is no longer a definition names nothing. Where a
 * label names nothing, the link is written inline with its address (R2), and
 * no reference to nothing reaches the file. A collapsed or shortcut link whose
 * text no longer reads as its label is written as a full reference (E1). The
 * link dialog drops the spelling of a link it changes, so a new address is
 * written inline (E2).
 */

/** Set on a link or image the file wrote as a reference: its form and label. Stamped (#447). */
export const REFERENCE_ATTRIBUTE = 'data-link-reference';

/** Set on a definition node, holding the indentation of its first line. Stamped (#447). */
export const REFERENCE_DEFINITION_ATTRIBUTE = 'data-reference-definition';

type Form = 'full' | 'collapsed' | 'shortcut';

/** A label as `marked` folds it to look it up. */
export function foldLabel(label: string): string {
  return label.replace(/\s+/g, ' ').toLowerCase();
}

/** The label of a full reference, at the end of its raw. */
const FULL = /\]\[((?:[^\]\\]|\\.)+)\]$/;

/**
 * The form and label of a link token from its raw, or `null` for an inline
 * link or an autolink: those end with `)` or open with `<`.
 */
export function referenceOf(raw: string): { form: Form; label: string } | null {
  const body = raw.startsWith('!') ? raw.slice(1) : raw;
  if (!body.startsWith('[') || body.endsWith(')')) return null;
  const full = FULL.exec(body);
  if (full) return { form: 'full', label: full[1] };
  if (body.endsWith('][]')) return { form: 'collapsed', label: body.slice(1, -3) };
  return { form: 'shortcut', label: body.slice(1, -1) };
}

/** The attribute for a link or image token, or nothing for an inline one. */
export function referenceAttribute(raw: string): string {
  const reference = referenceOf(raw);
  if (reference === null) return '';
  const value = encodeURIComponent(`${reference.form}:${reference.label}`);
  return ` ${REFERENCE_ATTRIBUTE}="${value}"`;
}

/** The form and label back from the attribute, or `null` where it is not believed. */
function decodeReference(value: string | null): { form: Form; label: string } | null {
  if (value === null) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  const at = decoded.indexOf(':');
  const form = decoded.slice(0, at);
  if (form !== 'full' && form !== 'collapsed' && form !== 'shortcut') return null;
  return { form, label: decoded.slice(at + 1) };
}

/** The mark and node attribute, read from the element and rendered back onto it. */
export function referenceMarkAttribute() {
  return {
    reference: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) => element.getAttribute(REFERENCE_ATTRIBUTE),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.reference === 'string'
          ? { [REFERENCE_ATTRIBUTE]: attributes.reference }
          : {},
    },
  };
}

/** The labels the document defines, folded, while a save writes it; set by `htmlToMarkdown`. */
let defined: ReadonlySet<string> = new Set();

/** Set the labels, and return the set they replace, for the caller to restore. */
export function setDefinedLabels(labels: ReadonlySet<string>): ReadonlySet<string> {
  const previous = defined;
  defined = labels;
  return previous;
}

/** Whether a reference with this label resolves in the document being written. */
export function resolves(label: string): boolean {
  return defined.has(foldLabel(label));
}

/** The label of the attribute on `element`, where it resolves, with its form. */
export function resolvedReference(element: Element): { form: Form; label: string } | null {
  const reference = decodeReference(element.getAttribute(REFERENCE_ATTRIBUTE));
  return reference !== null && resolves(reference.label) ? reference : null;
}

/**
 * The reference spelling of a link or image, or `null` where it is written
 * inline. `content` is the text as the serializer writes it, and `read` is
 * whether that text still reads as the label, so a collapsed or shortcut
 * link is written with its label as the file spelled it while it does (E1).
 */
export function referenceSpelling(
  element: Element,
  content: string,
  read: (label: string) => boolean,
  image: boolean,
): string | null {
  const reference = resolvedReference(element);
  if (reference === null) return null;
  const bang = image ? '!' : '';
  if (reference.form !== 'full' && read(reference.label)) {
    return `${bang}[${reference.label}]${reference.form === 'collapsed' ? '[]' : ''}`;
  }
  return `${bang}[${content}][${reference.label}]`;
}
