/**
 * #393 — Whole word finds a word of any script, whole.
 *
 * **Said first: this is observable here.** A search result is a pair of text
 * positions, not layout, so every row drives the real `SearchEngine` over a
 * real editor document and counts what it found.
 *
 * Each row runs twice, with the document and the query composed (NFC) and
 * decomposed (NFD), where a letter and its accent are two code points. A
 * boundary that held on one and broke on the other would not be the answer.
 * A query typed in one form does not find text in the other at all, Whole
 * word or not; that is normalisation, not the boundary, and not held here.
 *
 * The blocks fail in opposite directions, so a reversal shows which way it
 * went: a word missed, a word found inside a longer one, or the half that
 * must not move, a part of a word found with Whole word off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSearchEngine, type SearchOptions } from './search-extension';
import { createEditor, type EditorInstance } from './setup';

const FORMS = ['NFC', 'NFD'] as const;

let opened: EditorInstance | null = null;

afterEach(() => {
  opened?.destroy();
  opened = null;
});

/** How many times `query` is found in a document holding `markdown`, both in `form`. */
function found(
  query: string,
  markdown: string,
  form: (typeof FORMS)[number],
  wholeWord = true,
): number {
  const element = document.createElement('div');
  document.body.appendChild(element);
  opened = createEditor(element);
  opened.setMarkdown(`${markdown.normalize(form)}\n`);
  const options: SearchOptions = { caseSensitive: false, wholeWord, regex: false };
  const result = createSearchEngine(opened.editor).search(query.normalize(form), options);
  if (!result.ok) throw new Error(`${query}: ${result.error}`);
  return result.matches;
}

/** Each row as a pair, one per form. */
function inBothForms<T extends readonly unknown[]>(rows: readonly T[]) {
  return FORMS.flatMap((form) => rows.map((row) => [form, ...row] as const));
}

describe('Whole word finds a word with a letter outside A to Z at its edge (#393)', () => {
  it.each(
    inBothForms([
      ['școală', 'la școală azi'],
      ['până', 'până mâine'],
      ['ață', 'o ață lungă'],
      ['мир', 'привет мир'],
      ['über', 'für über'],
      // Split by a mark: the words of a paragraph are one run before matching.
      ['școală', 'la **școa**lă azi'],
    ]),
  )('%s: %s in %s, once', (form, query, text) => {
    expect(found(query, text, form)).toBe(1);
  });
});

describe('Whole word does not find a query inside a longer word (#393)', () => {
  it.each(
    inBothForms([
      ['cas', 'casă'],
      ['ma', 'mașină'],
      // In NFD the last letter of casă is an a and a breve, and the breve
      // alone must not end the word.
      ['casa', 'casă'],
    ]),
  )('%s: %s in %s, not at all', (form, query, text) => {
    expect(found(query, text, form)).toBe(0);
  });
});

describe('Whole word still finds what it found before (#393)', () => {
  it.each(
    inBothForms([
      ['cat', 'the cat sat', 1],
      ['cat', 'concatenate', 0],
      ['foo', 'foo_bar', 0],
      ['2026', 'anul 2026.', 1],
      ['o', 'într-o zi', 1],
      ['mâine', 'pe mâine.', 1],
      ['a.b', 'x a.b y', 1],
    ]),
  )('%s: %s in %s, %i', (form, query, text, count) => {
    expect(found(query, text, form)).toBe(count);
  });
});

describe('with Whole word off, a part of a word is still found (#393)', () => {
  it.each(
    inBothForms([
      ['cas', 'casă'],
      ['ma', 'mașină'],
    ]),
  )('%s: %s in %s, once', (form, query, text) => {
    expect(found(query, text, form, false)).toBe(1);
  });
});
