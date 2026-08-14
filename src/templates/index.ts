import blankFrontmatterBody from './blank-frontmatter.md?raw';
import meetingNoteBody from './meeting-note.md?raw';
import projectDocumentBody from './project-document.md?raw';
import readmeBody from './readme.md?raw';

export type TemplateId = 'readme' | 'project-document' | 'meeting-note' | 'blank-frontmatter';

export interface Template {
  readonly id: TemplateId;
  readonly displayName: string;
  readonly icon: string;
  readonly description: string;
  /** Raw markdown seed, frontmatter included when the template has one. */
  readonly body: string;
}

/**
 * The four plain markdown seeds offered by New from Template (R-A3).
 * Array order is gallery order. Every seed is standard markdown — a
 * template only saves typing, it never introduces a document kind.
 */
export const TEMPLATES: readonly Template[] = [
  {
    id: 'readme',
    displayName: 'README',
    icon: '\u{1F4D8}',
    description: 'Project README: what it does, how to install it, how to use it.',
    body: readmeBody,
  },
  {
    id: 'project-document',
    displayName: 'Project document',
    icon: '\u{1F4C4}',
    description: 'Context, goals, approach, open questions and next steps.',
    body: projectDocumentBody,
  },
  {
    id: 'meeting-note',
    displayName: 'Meeting note',
    icon: '\u{1F5D3}',
    description: 'Agenda, notes, decisions and a task list with checkboxes.',
    body: meetingNoteBody,
  },
  {
    id: 'blank-frontmatter',
    displayName: 'Blank + metadata',
    icon: '\u{1F3F7}',
    description: 'An empty document that starts with a metadata block (YAML frontmatter).',
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
