/**
 * The emoji list the palette offers (#296), as data and as text in a file.
 *
 * The list itself is the output of the rule written at the top of
 * `emoji-list.ts`, and nothing here runs that rule again: the sources are
 * published pages, not something a test may fetch (Q3). What is asserted is
 * what the rule promises of its output, and what an emoji does to a file.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
import { EMOJI } from './emoji-list';

const VARIATION_SELECTOR = '️';

/** Code points that make a sequence able to fall apart where a font does not know it. */
function isSequence(char: string): boolean {
  return Array.from(char).some((c) => {
    const cp = c.codePointAt(0) as number;
    return (
      cp === 0x200d || // zero-width joiner
      cp === 0x20e3 || // combining enclosing keycap
      (cp >= 0x1f1e6 && cp <= 0x1f1ff) || // regional indicators, which spell flags
      (cp >= 0xe0020 && cp <= 0xe007f) || // tag characters
      (cp >= 0x1f3fb && cp <= 0x1f3ff) // skin tone modifiers
    );
  });
}

describe('what the rule promises of the list', () => {
  it('holds 200, none of them twice, with or without a variation selector', () => {
    expect(EMOJI).toHaveLength(200);
    const bare = EMOJI.map(([char]) => char.replaceAll(VARIATION_SELECTOR, ''));
    expect(new Set(bare).size).toBe(200);
  });

  it('holds no sequence that can fall apart into separate symbols, and no skin tone', () => {
    expect(EMOJI.filter(([char]) => isSequence(char)).map(([char]) => char)).toEqual([]);
  });

  it('keeps the 24 that carry a variation selector, and each ends with it', () => {
    const selected = EMOJI.filter(([char]) => char.includes(VARIATION_SELECTOR));
    expect(selected).toHaveLength(24);
    for (const [char] of selected) {
      expect(Array.from(char)).toHaveLength(2);
      expect(char.endsWith(VARIATION_SELECTOR)).toBe(true);
    }
  });

  it('names every emoji, and leaves out the one the owner removed', () => {
    for (const [char, name] of EMOJI) expect(name.trim(), char).not.toBe('');
    expect(EMOJI.map(([char]) => char)).not.toContain('\u{1F595}');
  });
});

describe('what an emoji of the list does to a file', () => {
  let editor: EditorInstance | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  /** Loads and writes back, through one editor for the whole list. */
  function reread(markdown: string): string {
    if (editor === null) {
      const host = document.createElement('div');
      document.body.appendChild(host);
      editor = createEditor(host);
    }
    editor.setMarkdown(markdown);
    return editor.getMarkdown();
  }

  it('comes back byte for byte in a paragraph, every one of the 200', () => {
    const changed = EMOJI.filter(([char]) => reread(`one ${char} two`) !== `one ${char} two`);
    expect(changed.map(([char]) => char)).toEqual([]);
  });

  it('comes back byte for byte alone in a table cell, every one of the 200', () => {
    const table = (char: string) => `| a | ${char} |\n| --- | --- |\n| ${char} | b |`;
    const changed = EMOJI.filter(([char]) => reread(table(char)) !== table(char));
    expect(changed.map(([char]) => char)).toEqual([]);
  });

  it('holds still on a second save in a padded column, including those one UTF-16 unit long', () => {
    // A padded table is re-padded by UTF-16 units after an edit (#93), and an
    // emoji one unit long draws two columns wide, so its row reads one column
    // off in a monospace view. Whatever the padding, the file must not move
    // again on the next save.
    const narrow = EMOJI.filter(([char]) => char.length === 1).map(([char]) => char);
    expect(narrow.length).toBeGreaterThan(0);
    for (const char of narrow) {
      const once = reread(
        `| name  | done |\n| ----- | ---- |\n| alpha | yes ${char} |\n| beta  | no   |`,
      );
      expect(once, char).toContain(char);
      expect(reread(once), char).toBe(once);
    }
  });
});
