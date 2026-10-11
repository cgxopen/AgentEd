/**
 * The title of a link, kept with the delimiter the file wrote it in (#562,
 * owner decision of 2026-10-09: repaired before 1.0.0).
 *
 * `[AgentEd](https://agentedapp.com "Home")` came back without its title: the
 * serializer already wrote a title the `a` element carried, but the link mark
 * held none, so the title never reached it. The same loss #230 repaired for an
 * image, and found by the CommonMark suite of #561, 28 examples.
 *
 * ── The title on the mark, the delimiter beside it ──
 *
 * `marked` hands the link renderer the title, and `raw` ends with the
 * delimiter the file closed it with: `"`, `'` or `)`. Measured on 8706 files of
 * this machine: 283 inline link titles in 63 files, 280 in double quotes, 3 in
 * single quotes, none in parentheses; and 44 more read from a reference
 * definition, in 4 files. The title rides on the mark as the attribute it is in
 * HTML, and the delimiter beside it, written only where it is not `"`, the
 * delimiter the serializer writes unasked, the route #431 gave the marker of a
 * list. So the delimiter is kept, where the image title of #230 is respelled
 * with double quotes, a recorded exception.
 *
 * A title read from a reference definition is written inline with its link,
 * the respelling #570 is about, and in double quotes, since the definition is
 * not carried.
 *
 * **Shown**: the editor renders the title on the link, so the platform shows
 * it as a tooltip on hover, as a browser shows the file's title.
 */

/** Set on a link whose title the file closed with `'` or `)`. */
export const LINK_TITLE_DELIMITER_ATTRIBUTE = 'data-link-title-delimiter';

/** The opening delimiter of a title, by the character that closes it. */
const OPENER_OF: Readonly<Record<string, string>> = { "'": "'", ')': '(' };

/** The closing delimiter for each opening one, and what must be escaped inside. */
const DELIMITERS: Readonly<Record<string, { close: string; escape: RegExp }>> = {
  '"': { close: '"', escape: /"/g },
  "'": { close: "'", escape: /'/g },
  '(': { close: ')', escape: /[()]/g },
};

/** The attribute for a link token, or nothing for a title in double quotes or none. */
export function linkTitleDelimiterAttribute(raw: string, title: string | null | undefined): string {
  if (!title || !raw.endsWith(')')) return '';
  const closing = raw.slice(0, -1).trimEnd().slice(-1);
  const opener = OPENER_OF[closing];
  return opener === undefined ? '' : ` ${LINK_TITLE_DELIMITER_ATTRIBUTE}="${opener}"`;
}

/** The mark attributes: the title, rendered as HTML renders it, and its delimiter. */
export function linkTitleMarkAttributes() {
  return {
    title: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) => element.getAttribute('title'),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.title === 'string' && attributes.title !== ''
          ? { title: attributes.title }
          : {},
    },
    titleDelimiter: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute(LINK_TITLE_DELIMITER_ATTRIBUTE);
        return value !== null && value in DELIMITERS ? value : null;
      },
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.titleDelimiter === 'string'
          ? { [LINK_TITLE_DELIMITER_ATTRIBUTE]: attributes.titleDelimiter }
          : {},
    },
  };
}

/**
 * The title of a link as the serializer writes it after the destination, a
 * space first, or nothing. Newlines collapse as turndown collapses them, and
 * inside the delimiters each character that would close them is written with
 * a backslash, which CommonMark reads back as the character.
 */
export function linkTitle(link: HTMLElement): string {
  const raw = link.getAttribute('title');
  if (!raw) return '';
  const opener = link.getAttribute(LINK_TITLE_DELIMITER_ATTRIBUTE) ?? '"';
  const delimiter = DELIMITERS[opener] ?? DELIMITERS['"'];
  if (delimiter === undefined) return '';
  const collapsed = raw.replace(/(\n+\s*)+/g, '\n');
  const body = collapsed.replace(delimiter.escape, (character) => `\\${character}`);
  return ` ${opener in DELIMITERS ? opener : '"'}${body}${delimiter.close}`;
}
