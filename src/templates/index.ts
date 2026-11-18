import agentInstructionsBody from './agent-instructions.md?raw';
import blankBody from './blank.md?raw';
import blankFrontmatterBody from './blank-frontmatter.md?raw';

export type TemplateId = 'blank' | 'agent-instructions' | 'blank-frontmatter';

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
 * The seed of the Agent instructions block (#715), and the body of the Agent
 * Instructions card (#754). **One address for both routes**: the card below
 * takes this string as its body, and Insert → Metadata reads its block from
 * here through `splitFrontmatter`, so the gallery and the menu write the same
 * block and cannot drift apart. The block alone, with no heading. `name` is
 * empty on purpose: for a skill it is carried by the folder, not the file.
 */
export const AGENT_INSTRUCTIONS_SEED: string = agentInstructionsBody;

/**
 * The three plain markdown seeds offered by New from Template (R-C18).
 * Array order is gallery order. Every seed is standard markdown — a
 * template only saves typing, it never introduces a document kind.
 *
 * **README, project document and meeting note left at #403, and none of
 * them came from the Skills concept** — this is an owner product decision
 * rather than the removal of machinery. Three seeds that each guessed at a
 * shape gave way to two that describe what a markdown file can be: one
 * with a metadata block and one without. **Agent Instructions joined them at
 * #754**, between the two, by owner decision of 2026-11-18: the block
 * Insert → Metadata already offered for agent files, so the gallery and that
 * menu agree in what they write and in their order.
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
    id: 'agent-instructions',
    displayName: 'Agent Instructions',
    icon: '\u{1F916}',
    description:
      'A file an AI agent reads, such as a skill or a rule file, with a block at the top for its name and description (YAML frontmatter) — edited in a panel, kept in the file as plain text.',
    body: AGENT_INSTRUCTIONS_SEED,
  },
  {
    id: 'blank-frontmatter',
    displayName: 'Document with Metadata',
    icon: '\u{1F3F7}',
    description:
      'A markdown file with a block at the top for title, date, author and tags (YAML frontmatter) — edited in a panel, kept in the file as plain text. Can hold images too.',
    body: blankFrontmatterBody,
  },
];

/**
 * The two blocks Insert → Metadata offers (#715): **Agent instructions**, `name`
 * and `description` and nothing else, the minimum the formats of agent files
 * share, and **Document**, the block of the Document with Metadata template.
 * Each is also a card of the gallery since #754, in the same order.
 */
export type MetadataBlockKind = 'document' | 'agent';

/**
 * Look up a template by id. Returns `undefined` for an unknown id so
 * callers decide how to fail — the gallery only ever passes ids it just
 * rendered from `TEMPLATES`.
 */
export function getTemplate(id: TemplateId): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
