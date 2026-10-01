import blankBody from './blank.md?raw';
import blankFrontmatterBody from './blank-frontmatter.md?raw';

export type TemplateId = 'blank' | 'blank-frontmatter';

export interface Template {
  readonly id: TemplateId;
  readonly displayName: string;
  readonly icon: string;
  /**
   * The card text in the gallery, and the only place a template explains
   * itself. Longer than one line since #403, because the explanation moved
   * here out of the documents: a seed writes what the person asked for and
   * nothing else, and the card is where the offer is described.
   */
  readonly description: string;
  /** Raw markdown seed, frontmatter included when the template has one. */
  readonly body: string;
}

/**
 * The two plain markdown seeds offered by New from Template (R-C18).
 * Array order is gallery order. Every seed is standard markdown — a
 * template only saves typing, it never introduces a document kind.
 *
 * **README, project document and meeting note left at #403, and none of
 * them came from the Skills concept** — this is an owner product decision
 * rather than the removal of machinery. Three seeds that each guessed at a
 * shape gave way to two that describe what a markdown file can be: one
 * with a metadata block and one without.
 *
 * The card texts are owner-approved word for word. They are read from here
 * by the gallery and by the test that pins them, so the approved wording
 * lives at one address.
 */
export const TEMPLATES: readonly Template[] = [
  {
    id: 'blank',
    displayName: 'Blank Document',
    icon: '\u{1F4C4}',
    description:
      'A plain markdown file for notes, READMEs, knowledge. Can hold resizable images — paste, drop, or Insert → Image.',
    body: blankBody,
  },
  {
    id: 'blank-frontmatter',
    displayName: 'Document with Metadata',
    icon: '\u{1F3F7}',
    description:
      'The same, with a block at the top for title, date, author and tags (YAML frontmatter) — edited in a panel, kept in the file as plain text. Can hold images too.',
    body: blankFrontmatterBody,
  },
];

/**
 * Look up a template by id. Returns `undefined` for an unknown id so
 * callers decide how to fail — the gallery only ever passes ids it just
 * rendered from `TEMPLATES`.
 */
export function getTemplate(id: TemplateId): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
