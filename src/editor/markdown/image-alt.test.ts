/**
 * An image alt text, in and out (#232).
 *
 * Two members, two layers, one value.
 *
 *  - **Member 1 is at the parser.** `marked` writes the `title` of an image
 *    escaped and the `alt` raw — one line apart in its own renderer — so an alt
 *    holding a double quote produced `alt="say "hi""`, which no parser can
 *    read, and DOMPurify kept the first word. The words were gone before the
 *    document existed, so nothing downstream could have recovered them.
 *  - **Member 2 is at the serializer.** `imageMarkup` interpolated the alt into
 *    `![…]` with nothing escaped, so an alt holding a `]` closed the brackets
 *    early and the reference stopped being an image.
 *
 * They are held together here because they are the same value at opposite ends,
 * and because a fixture that goes in has to come back out to mean anything.
 *
 * ── The equivalence guard, and why it is the important half ──
 *
 * The renderer override restates two small pieces of `marked` — its attribute
 * escape and its `cleanUrl` — because there is no way to call the library's own
 * and adjust one attribute. Restating a library is how a silent divergence
 * starts, so `matches marked byte for byte` below renders a fixture through a
 * **pristine** `Marked` instance and asserts the output is identical wherever
 * the escape cannot apply. A release that changes the shape fails there rather
 * than in somebody's document.
 */
import { Marked } from 'marked';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';
import { LINK_DESTINATION_ATTRIBUTE } from './destination-spelling';
import { markdownToHtml } from './parse';

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

/** Open `markdown`, save it unedited, and hand back what was written. */
function openAndSave(markdown: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  const saved = instance.getMarkdown().trim();
  instance.destroy();
  instance = null;
  return saved;
}

/** The `alt` the pipeline ends up with, read off the parsed element. */
function altOf(markdown: string): string | null {
  const box = document.createElement('div');
  box.innerHTML = markdownToHtml(markdown);
  return box.querySelector('img')?.getAttribute('alt') ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Member 1 — the parser
// ─────────────────────────────────────────────────────────────────────────────

describe('an alt text reaches the document whole (#232, member 1)', () => {
  it.each([
    ['a double quote', '![say "hi"](i.png)', 'say "hi"'],
    ['two double quotes', '![a "b" c "d"](i.png)', 'a "b" c "d"'],
    ['a double quote at the end', '![say "](i.png)', 'say "'],
    ['a single quote', "![it's here](i.png)", "it's here"],
    ['an ampersand', '![a & b](i.png)', 'a & b'],
    ['an angle bracket', '![a < b](i.png)', 'a < b'],
    ['a closing angle bracket', '![a > b](i.png)', 'a > b'],
    ['a backslash', '![a \\\\ b](i.png)', 'a \\ b'],
    ['an entity the file wrote', '![a &amp; b](i.png)', 'a & b'],
    ['nothing that needs escaping', '![plain](i.png)', 'plain'],
    ['no alt at all', '![](i.png)', ''],
  ])('an alt holding %s survives the parser', (_label, markdown, alt) => {
    // The measurement that named the layer: only the double quote was broken,
    // and the other four are here because the repair is the whole escape rather
    // than that one character — a writer that escaped too much would be as
    // wrong as one that escaped too little, and each of these says so.
    expect(altOf(markdown)).toBe(alt);
  });

  it.each([
    ['a double quote', '![say "hi"](i.png)'],
    ['a single quote', "![it's here](i.png)"],
    ['an ampersand', '![a & b](i.png)'],
    ['an angle bracket', '![a < b](i.png)'],
    ['a backslash', '![a \\\\ b](i.png)'],
    ['a double quote beside a title', '![say "hi"](i.png "the title")'],
  ])('an alt holding %s round-trips byte for byte', (_label, markdown) => {
    expect(openAndSave(markdown)).toBe(markdown);
  });

  it('inline markup inside an alt is still flattened, as an attribute needs', () => {
    // Not a change this makes — an attribute cannot hold elements and the
    // default flattened them too. Here so a repair that started rendering them
    // fails rather than surprising somebody.
    expect(altOf('![a **bold** b](i.png)')).toBe('a bold b');
  });
});

describe('the renderer matches marked byte for byte where the escape cannot apply', () => {
  /**
   * A `marked` with none of this repository's configuration on it. Built here
   * rather than imported so it cannot pick up an override by accident, which
   * would make this test agree with itself.
   */
  function pristine(markdown: string): string {
    return new Marked().parse(markdown, { async: false }) as string;
  }

  it.each([
    ['a plain alt', '![plain](i.png)'],
    ['no alt', '![](i.png)'],
    ['a title', '![a](i.png "the title")'],
    ['a relative address', '![a](assets/deep/img.png)'],
    ['an absolute address', '![a](https://example.com/i.png)'],
    ['an address holding a space', '![a](<i mg.png>)'],
    ['an address holding a percent', '![a](i%20mg.png)'],
    ['an address holding a unicode name', '![a](imágenes/foto.png)'],
    ['an alt holding a bracket', '![a \\[b\\] c](i.png)'],
    ['an alt holding a backslash', '![a \\\\ b](i.png)'],
    ['inline markup in the alt', '![a **bold** b](i.png)'],
    ['an image inside a link', '[![a](i.png "t")](https://e.com)'],
    ['an image in a list item', '- ![a](i.png)'],
  ])('%s renders exactly as the library would', (_label, markdown) => {
    // None of these holds a character the escape touches, so the two must agree
    // to the byte. Where they would differ is the whole point of the change and
    // has its own tests above.
    // A link around the image carries what it wrote between its parentheses (#573).
    const ours = markdownToHtml(markdown).replace(
      new RegExp(` ${LINK_DESTINATION_ATTRIBUTE}="[^"]*"`),
      '',
    );
    expect(ours).toBe(pristine(markdown));
  });

  it('and differs only by the escape where one is needed', () => {
    // The other side of the same claim, so this pair cannot both be satisfied
    // by a renderer that does nothing at all.
    const markdown = '![say "hi"](i.png)';
    expect(markdownToHtml(markdown)).not.toBe(pristine(markdown));
    expect(pristine(markdown)).toContain('alt="say "hi""');
    expect(markdownToHtml(markdown)).toContain('alt="say &quot;hi&quot;"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Member 2 — the serializer
// ─────────────────────────────────────────────────────────────────────────────

describe('an alt text is written back into brackets it cannot break (#232, member 2)', () => {
  it.each([
    ['an escaped closing bracket', '![a \\] b](i.png)'],
    ['an escaped opening bracket', '![a \\[ b](i.png)'],
    ['a pair of escaped brackets', '![a \\[b\\] c](i.png)'],
    ['a backslash', '![a \\\\ b](i.png)'],
    ['a bracket beside a title', '![a \\] b](i.png "the title")'],
    ['a bracket and a quote together', '![a \\] "b"](i.png)'],
  ])('an alt holding %s round-trips byte for byte', (_label, markdown) => {
    expect(openAndSave(markdown)).toBe(markdown);
  });

  it.each([
    ['an escaped closing bracket', '![a \\] b](i.png)'],
    ['an escaped opening bracket', '![a \\[ b](i.png)'],
    ['a backslash', '![a \\\\ b](i.png)'],
  ])('and is still an image after the save, not text (%s)', (_label, markdown) => {
    // **The half byte equality alone would not have caught.** What the bare
    // form did was not a respelling: `![a ] b](i.png)` stopped being an image,
    // and the next save wrote the whole line as escaped text. A document that
    // survives as bytes but not as a document is the failure underneath both.
    expect(altOf(openAndSave(markdown))).not.toBeNull();
  });

  it.each([
    ['an escaped closing bracket', '![a \\] b](i.png)'],
    ['an escaped opening bracket', '![a \\[ b](i.png)'],
    ['a pair of escaped brackets', '![a \\[b\\] c](i.png)'],
    ['a backslash', '![a \\\\ b](i.png)'],
    ['a double quote', '![say "hi"](i.png)'],
  ])('the second and third save move nothing (%s)', (_label, markdown) => {
    // The property #96 records and the one this defect broke: the first save
    // moved the file and the second moved it again. Three saves, because a
    // fixed point reached at the second is what the old shape looked like from
    // the second onwards and this has to be distinguishable from it.
    const first = openAndSave(markdown);
    const second = openAndSave(first);
    expect(second).toBe(first);
    expect(openAndSave(second)).toBe(second);
  });

  it('an alt with nothing to escape gains no backslashes', () => {
    // The regression half: a writer that escaped everything would pass every
    // test above and put backslashes into every document in the repository.
    expect(openAndSave('![plain alt](i.png)')).toBe('![plain alt](i.png)');
    expect(openAndSave('![a (b) c](i.png)')).toBe('![a (b) c](i.png)');
    expect(openAndSave('![a ! b](i.png)')).toBe('![a ! b](i.png)');
  });
});
