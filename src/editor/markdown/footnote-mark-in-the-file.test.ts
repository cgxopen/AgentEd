import { beforeEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';
import { DEFINITION_POSITION, setDocumentCarriesTheMark } from './escape';
import { markdownToHtml } from './parse';
import { htmlToMarkdown } from './serialize';

/**
 * Issue #409, second head — a document that already carries U+E012 keeps it.
 *
 * **What it was, measured at `42457a3`**: `resolveDefinitionPositions` ends by
 * sweeping the assembled markdown for the mark, and the assembled markdown
 * includes every place the escape never runs. So the character was deleted
 * from a fenced block, from a code span and from ordinary prose — three bytes
 * each, which is what it weighs in UTF-8 — and where it stood in front of a
 * reference, the reference was escaped as well and stopped being a footnote.
 *
 * The other three sentinels of `escape.ts` were never at risk, because nothing
 * downstream of the escape looks for them again; row f is that contrast.
 *
 * **The repair is the node rule at document scope** (owner decision of
 * 2026-09-23, A2): a document carrying the character is written with no mark
 * made and the reference narrowing given up entirely. Its cost is rows c and
 * d, where a reference gains the backslashes turndown writes — accepted in
 * writing against the alternative, which dropped the backslashes of a line the
 * file had escaped and let it reopen as a real definition (row g).
 */

const MARK = DEFINITION_POSITION;

let instance: EditorInstance | null = null;

beforeEach(() => {
  instance?.destroy?.();
  instance = null;
});

function atTheEditor(markdown: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  instance = editor;
  editor.setMarkdown(markdown);
  return editor.getMarkdown();
}

function atThePair(markdown: string): string {
  return htmlToMarkdown(markdownToHtml(markdown));
}

/** Both levels, since the #404 spike found a case where they disagreed. */
function survives(markdown: string): void {
  expect(atThePair(markdown).trim()).toBe(markdown.trim());
  expect(atTheEditor(markdown).trim()).toBe(markdown.trim());
}

/** What the file weighs, so a row can say bytes rather than characters. */
const bytes = (text: string): number => new TextEncoder().encode(text).length;

describe('the mark character, where the file itself holds it (#409)', () => {
  it('a, inside a fenced block — before: 31 bytes in, 28 out', () => {
    const source = `\`\`\`\nconst sentinel = "${MARK}";\n\`\`\`\n`;
    expect(bytes(source.trim())).toBe(31);
    survives(source);
  });

  it('b, in a paragraph with no reference near it — before: 38 in, 35 out', () => {
    const source = `A paragraph holding ${MARK} in the middle.\n`;
    expect(bytes(source.trim())).toBe(38);
    survives(source);
  });

  it('c, in front of a reference at a line start — the character is kept', () => {
    // The reference gains the backslashes turndown writes, which is the
    // narrowing given up: 34 bytes in, 36 out. What it may not do is lose the
    // character, which is what it did at `42457a3` — 33 bytes out.
    const source = `${MARK}[^1]: see below\n\n[^1]: the note`;
    const once = atTheEditor(source).trim();

    expect(once).toBe(`${MARK}\\[^1\\]: see below\n\n[^1]: the note`);
    expect(bytes(source)).toBe(34);
    expect(bytes(once)).toBe(36);
    expect(atTheEditor(once).trim()).toBe(once);
  });

  it('d, in front of a reference inside a sentence — the character is kept', () => {
    const source = `Text ${MARK}[^1] here.\n\n[^1]: the note`;
    const once = atTheEditor(source).trim();

    expect(once).toBe(`Text ${MARK}\\[^1\\] here.\n\n[^1]: the note`);
    expect(atTheEditor(once).trim()).toBe(once);
  });

  it('e, inside a code span — before: 16 bytes in, 13 out', () => {
    const source = `Text \`${MARK}\` here.\n`;
    expect(bytes(source.trim())).toBe(16);
    survives(source);
  });

  it('f, the three older sentinels, which were never at risk', () => {
    survives('Text  and  and  here.\n');
  });

  /**
   * **The row that chose A2 over A1**, and the only shape the two disagree on.
   * The character stands in a fenced block, and in another block sits a line
   * the file escaped as text. Holding the reference unescaped — which is all
   * that "no mark is made" requires — drops those backslashes and the line
   * reopens as a real definition: 57 bytes in, 55 out, and the document a
   * different shape. Giving the narrowing up keeps both.
   */
  it('g, the character in a fence and an escaped line elsewhere — 57 in, 57 out', () => {
    const source = `\`\`\`\n${MARK}\n\`\`\`\n\nA paragraph.\n\n\\[^a\\]: text, not a definition\n`;
    expect(bytes(source.trim())).toBe(57);
    survives(source);

    const once = atTheEditor(source).trim();
    expect(bytes(once)).toBe(57);
    // And it reopens as the paragraph it was, not as a definition.
    expect(markdownToHtml(once)).not.toContain('data-footnote-definition');
  });

  it('and no mark ever reaches a file, in a document that carries none', () => {
    const once = atTheEditor('Text.[^1] more.\n\n[^1]: the note');

    expect(once).not.toContain(MARK);
    expect(once.trim()).toBe('Text.[^1] more.\n\n[^1]: the note');
  });
});

describe('the flag a save sets is given back as it found it (#288, paid on #564)', () => {
  it('restores the value it held rather than clearing it', () => {
    // A call made while another is writing must not switch the flag off under
    // it, the reason `writingKeptTables` is restored beside it.
    setDocumentCarriesTheMark(true);
    htmlToMarkdown('<p>x</p>');
    expect(setDocumentCarriesTheMark(false)).toBe(true);
    htmlToMarkdown('<p>x</p>');
    expect(setDocumentCarriesTheMark(false)).toBe(false);
  });
});
