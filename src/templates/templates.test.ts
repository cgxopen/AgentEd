import { describe, expect, it } from 'vitest';
import { getTemplate, TEMPLATES, type TemplateId } from './index';

/**
 * Issue #403 — the gallery offers two seeds, and the cards carry the texts the
 * owner approved word for word.
 *
 * **Said at the head: how the gallery reads is layout, and no row here sees
 * it.** happy-dom performs no layout, so whether a card text wraps, is cut, or
 * pushes the gallery into a scroll is the owner pass on the artifact. The
 * figures that decided it were measured in Chromium against the built page and
 * are on the issue: at the 600x400 minimum the two cards do not scroll where
 * the four did by 80 px, and no text is cut at either size.
 *
 * What these rows assert is what the gallery is handed: which seeds exist, what
 * each card says, and what each seed writes into the document.
 */

/** The approved texts, quoted from #403 rather than from the module under test. */
const APPROVED: Record<TemplateId, { name: string; card: string }> = {
  blank: {
    name: 'Blank Document',
    card: 'A plain markdown file for notes, READMEs, knowledge. Can hold resizable images — paste, drop, or Insert → Image.',
  },
  'blank-frontmatter': {
    name: 'Document with Metadata',
    card: 'The same, with a block at the top for title, date, author and tags (YAML frontmatter) — edited in a panel, kept in the file as plain text. Can hold images too.',
  },
};

describe('the gallery offers two seeds and no more (#403)', () => {
  it('there are exactly two, in the order the gallery draws them', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['blank', 'blank-frontmatter']);
  });

  it('README, project document and meeting note are gone', () => {
    // A product decision rather than Skills cleanup: none of the three came
    // from that concept, and the owner took them out of the gallery anyway.
    for (const id of ['readme', 'project-document', 'meeting-note']) {
      expect(getTemplate(id as TemplateId)).toBeUndefined();
    }
  });

  it('each card carries the approved name and the approved text', () => {
    for (const template of TEMPLATES) {
      const approved = APPROVED[template.id];
      expect(approved, `no approved text for ${template.id}`).toBeDefined();
      expect(template.displayName).toBe(approved.name);
      expect(template.description).toBe(approved.card);
    }
  });

  it('the card text is where the door is spelled, and it is spelled one way', () => {
    // README and R-C5 say the same thing since #403; this row holds the third
    // place, so a later edit to one of the two cannot leave the card behind.
    expect(TEMPLATES[0].description).toContain('Insert → Image');
  });
});

describe('what each seed writes into the document (#403)', () => {
  it('Blank Document writes an empty document', () => {
    expect(getTemplate('blank')?.body).toBe('');
  });

  it('Document with Metadata writes the block and the heading', () => {
    const body = getTemplate('blank-frontmatter')?.body ?? '';
    expect(body).toBe(
      [
        '---',
        'title: Untitled',
        'description:',
        'author:',
        'date:',
        'tags: []',
        '---',
        '',
        '# Untitled',
        '',
      ].join('\n'),
    );
  });

  it('and no explanatory sentence under it', () => {
    // The two lines that used to follow the heading left at #403: the
    // explanation lives on the card, and the document holds what the person
    // asked for. This row is what the reversal of that decision turns red.
    const body = getTemplate('blank-frontmatter')?.body ?? '';
    const afterHeading = body.slice(body.indexOf('# Untitled') + '# Untitled'.length);
    expect(afterHeading.trim()).toBe('');
    expect(body).not.toMatch(/Start writing here/);
    expect(body).not.toMatch(/is not part of the document text/);
  });
});
