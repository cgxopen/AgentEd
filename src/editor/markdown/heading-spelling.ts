import { marked, type Token } from 'marked';

/**
 * How the file spelled a heading, where it is not the spelling written unasked
 * (#573, owner decisions A and D of 2026-10-16 on the step zero).
 *
 * `serialize.ts` writes every heading with opening hashes and nothing after
 * its text, so `Title` over `=====` came back `# Title`, and `## Title ##`
 * came back `## Title`: the same rendering, other bytes. Measured on the step
 * zero of #573, on the frozen corpus of 8361 files: 404 files held 4705
 * underlined headings, every one written with hashes, and 16 files held 110
 * headings with closing hashes.
 *
 * ── Read from the token, carried on the node ──
 *
 * `marked` hands each `heading` token its `raw`, the lines the file wrote;
 * the heading node holds its level and its text and nothing of how they were
 * spelled, so the spelling travels as two attributes, the route #431 gave the
 * marker of a list and #566 the delimiter of an emphasis:
 *
 *  - an underlined heading carries its underline, the run of `=` or `-` as
 *    the file wrote it, longer or shorter than the text;
 *  - a heading opened with hashes carries its closing sequence, the spaces
 *    before the closing hashes and the hashes, and not the spaces after them.
 *
 * **Only a file.** The attributes are stamped only where the parse keeps raw
 * HTML, which is a file and never a paste, as `adjacency.ts` stamps its flag;
 * a heading the editor makes carries none and is written as before.
 *
 * ── What is not carried ──
 *
 * An underlined heading whose text runs over two lines keeps the spelling it
 * had before, the hashes, with the line break written as a space: the soft
 * break cannot be held inside a heading (#571), and `soft-break-route.test.ts`
 * pins that row. The spaces after the opening hashes and after the text are
 * not carried either; both are recorded under R-C2. So is the indentation of
 * the heading and of its underline.
 *
 * ── Checked at save ──
 *
 * An edit can give the heading a level or a text the spelling cannot hold:
 * an underline of `=` writes a first-level heading only, and text such as
 * `- a` over a line of hyphens is a list item and a rule. So the spelling is
 * written only where `marked` reads it back as the same heading the hash
 * spelling gives, and the hash spelling is written otherwise. A heading
 * turned into a paragraph and back has lost both attributes with its node.
 */

/** Set on a heading the file underlined: the underline run. */
export const SETEXT_UNDERLINE_ATTRIBUTE = 'data-setext-underline';
/** Set on a heading the file closed with hashes: the closing sequence. */
export const ATX_CLOSING_ATTRIBUTE = 'data-atx-closing';

const UNDERLINE = /^(?:=+|-+)$/;
/** The closing sequence of one line: spaces or tabs, then hashes, at the end. */
const CLOSING = /[ \t]+#+$/;
/** The opening of an ATX heading: up to three spaces, then one to six hashes. */
const OPENING = /^ {0,3}#{1,6}(?=[ \t]|$)/;

/** The attributes for the tag of a `heading` token, or nothing. */
export function headingSpellingAttributes(raw: string, depth: number, fromAFile: boolean): string {
  if (!fromAFile) return '';
  const lines = raw.replace(/\n+$/, '').split('\n');
  const first = lines[0] ?? '';
  if (!OPENING.test(first)) {
    // Underlined: one line of text and its underline, nothing else.
    if (lines.length !== 2) return '';
    const underline = (lines[1] ?? '').trim();
    const fits = depth === 1 ? underline.startsWith('=') : underline.startsWith('-');
    return UNDERLINE.test(underline) && fits ? ` ${SETEXT_UNDERLINE_ATTRIBUTE}="${underline}"` : '';
  }
  const text = first.replace(OPENING, '').replace(/[ \t]+$/, '');
  const closing = CLOSING.exec(text)?.[0];
  // A heading that is hashes alone has no text for a closing sequence to close.
  if (closing === undefined || text.slice(0, -closing.length).trim() === '') return '';
  // Encoded, since the sanitizer trims an attribute value and the spaces
  // before the hashes are half of the spelling.
  return ` ${ATX_CLOSING_ATTRIBUTE}="${encodeURIComponent(closing)}"`;
}

const CLOSING_SEQUENCE = /^[ \t]+#+$/;

/** The closing sequence an attribute value encodes, or null where it encodes none. */
function closingOf(value: string | null): string | null {
  if (value === null) return null;
  try {
    const decoded = decodeURIComponent(value);
    return CLOSING_SEQUENCE.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * The two node attributes at the value a heading the editor makes holds.
 * `keepOnSplit: false` covers Enter at the end of a heading alone; the second
 * half of a split elsewhere is cleared by the plugin #594 gave the adjacency
 * flag, in `adjacent-blocks.ts`, which reads this.
 */
export const HEADING_SPELLING_UNSET: Readonly<Record<string, null>> = {
  setextUnderline: null,
  atxClosing: null,
};

/** The two node attributes, read from the element and rendered back onto it. */
export function headingSpellingNodeAttributes() {
  return {
    setextUnderline: {
      default: null as string | null,
      // Enter at the end of a heading makes a paragraph, which holds none.
      keepOnSplit: false,
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute(SETEXT_UNDERLINE_ATTRIBUTE);
        return value !== null && UNDERLINE.test(value) ? value : null;
      },
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.setextUnderline === 'string'
          ? { [SETEXT_UNDERLINE_ATTRIBUTE]: attributes.setextUnderline }
          : {},
    },
    atxClosing: {
      default: null as string | null,
      keepOnSplit: false,
      parseHTML: (element: HTMLElement) => closingOf(element.getAttribute(ATX_CLOSING_ATTRIBUTE)),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.atxClosing === 'string'
          ? { [ATX_CLOSING_ATTRIBUTE]: encodeURIComponent(attributes.atxClosing) }
          : {},
    },
  };
}

/** The one heading `markdown` reads as, by level and text, or null. */
function onlyHeading(markdown: string): { depth: number; text: string } | null {
  const blocks = marked.lexer(markdown).filter((token: Token) => token.type !== 'space');
  const heading = blocks[0] as { type?: string; depth?: number; text?: string } | undefined;
  if (blocks.length !== 1 || heading?.type !== 'heading') return null;
  return { depth: heading.depth ?? 0, text: heading.text ?? '' };
}

function readsAlike(spelled: string, hashes: string): boolean {
  const a = onlyHeading(spelled);
  const b = onlyHeading(hashes);
  return a !== null && b !== null && a.depth === b.depth && a.text === b.text;
}

/**
 * The heading as the file spelled it, or `written`, the hash spelling, where
 * it carries no spelling or the spelling would read as another heading.
 * `content` is the text as turndown escaped it, before the escapes the hash
 * spelling does without; `written` is what the heading rule wrote.
 */
export function withHeadingSpelling(node: HTMLElement, content: string, written: string): string {
  const hashes = written.trim();
  if (hashes === '' || content.includes('\n')) return written;
  const underline = node.getAttribute(SETEXT_UNDERLINE_ATTRIBUTE);
  if (underline !== null && UNDERLINE.test(underline)) {
    const spelled = `${content.trim()}\n${underline}`;
    if (readsAlike(spelled, hashes)) return `\n\n${spelled}\n\n`;
  }
  const closing = closingOf(node.getAttribute(ATX_CLOSING_ATTRIBUTE));
  if (closing !== null) {
    const spelled = `${hashes}${closing}`;
    if (readsAlike(spelled, hashes)) return `\n\n${spelled}\n\n`;
  }
  return written;
}
