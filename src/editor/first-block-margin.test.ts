import { beforeEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { reaches, stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { createEditor, type EditorInstance } from './setup';

/**
 * Issue #416 — the first block of a document has no margin above it.
 *
 * **Said first: how much room a document has above it is layout, and no row
 * here sees it.** happy-dom performs no layout — every box is zero and no
 * margin is ever applied — so a test that rendered a document and asked where
 * its first line landed would assert nothing. The figures that decided this
 * were measured in Chromium against the built page and are on the issue: from
 * the editor content top to the first ink, **46 px before and 14 after** for a
 * heading, 15 and 7 for a paragraph, at 100 and at 125 per cent alike.
 *
 * What these rows join is the two halves that *are* observable, and neither
 * asserts anything alone: the rule is **read out of the shipped stylesheet**
 * rather than restated, and its selector is run against the element the editor
 * **actually rendered** for each shape. A rule that existed but reached nothing
 * would pass the first half and fail the second; one that reached everything
 * would pass both and is caught by the row that holds the blocks below.
 */

const rules = stylesheetRules(stylesCss);

/**
 * Every rule in the sheet that takes a top margin off something. The sheet has
 * more than one - a task list zeroes the first block inside its item - so the
 * rule this issue adds is not picked out by its text but by **what it reaches**:
 * the first block of a document the editor rendered.
 */
const ZERO_TOP_MARGIN = rules.filter((rule) => rule.declarations.get('margin-top') === '0');

/** The rules of the sheet that take the top margin off `block`. */
function zeroingRulesFor(block: HTMLElement) {
  return ZERO_TOP_MARGIN.filter((rule) => reaches(rule.selector, block));
}

let host: HTMLElement;
let editor: EditorInstance | null = null;

beforeEach(() => {
  editor?.destroy?.();
  host = document.createElement('div');
  document.body.appendChild(host);
});

/** The blocks the editor renders for `markdown`, in document order. */
function blocksOf(markdown: string): HTMLElement[] {
  const instance = createEditor(host);
  editor = instance;
  instance.setMarkdown(markdown);
  const surface = host.querySelector('.tiptap');
  if (!surface) throw new Error('the editor rendered no .tiptap surface');
  return Array.from(surface.children) as HTMLElement[];
}

/** The seven shapes of the step zero, each as the document begins with it. */
const SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['a heading', '# A guide to natural light\n\nNatural light is simple.'],
  ['a second-level heading', '## A guide\n\nNatural light is simple.'],
  ['a paragraph', 'Natural light is simple.\n\nMore of it.'],
  ['a list', '- First item\n- Second item'],
  ['a code block', '```\nconst light = true;\n```\n\nAfter.'],
  ['a table', '| Session | Focus |\n| --- | --- |\n| Morning | Window light |\n\nAfter.'],
];

describe('the rule exists, in the shipped stylesheet (#416)', () => {
  it('one rule takes the top margin off the first block, and only one', () => {
    const found = zeroingRulesFor(blocksOf(SHAPES[0][1])[0]);
    expect(found.length).toBe(1);
    expect(found[0].declarations.get('margin-top')).toBe('0');
  });

  it('applies at every width, so no window size escapes it', () => {
    // Inside a media query it would hold at some widths and not others, and the
    // room above a document would depend on the window again.
    expect(zeroingRulesFor(blocksOf(SHAPES[0][1])[0])[0].conditions).toEqual([]);
  });

  it('says nothing but the top margin', () => {
    // Out of scope for this issue: the spacing between blocks, the measure and
    // the heading sizes. A rule that set more than this would reach all three.
    const found = zeroingRulesFor(blocksOf(SHAPES[0][1])[0]);
    expect([...found[0].declarations.keys()]).toEqual(['margin-top']);
  });

  it('#editor gives the top half a character height and keeps its sides', () => {
    // The second owner decision of 2026-09-22, taken on the captures of the
    // first head: 8 px is half of the 16 px the document is set in, and the
    // sides keep the room they had. The floating toolbar going below a
    // selection in the first line follows from this and needs no rule of its
    // own - which is why nothing here asserts it, and why the manual pass is
    // where it is looked at.
    const editorRules = rules.filter((rule) => rule.selector === '#editor');
    const padding = editorRules.map((rule) => rule.declarations.get('padding')).filter(Boolean);
    expect(padding).toContain('8px 40px 40px');
  });
});

describe('the rule reaches the first block the editor renders, and only it (#416)', () => {
  it.each(SHAPES)('%s, as the document begins with it', (_name, markdown) => {
    const blocks = blocksOf(markdown);
    expect(blocks.length).toBeGreaterThan(0);
    // The half that matters: the rule is run against what the editor rendered,
    // not against a tag name written here.
    expect(zeroingRulesFor(blocks[0]).length, `nothing zeroes ${blocks[0].tagName}`).toBe(1);
  });

  it('and never the blocks below it, whose margin does its job', () => {
    for (const [name, markdown] of SHAPES) {
      const blocks = blocksOf(markdown);
      for (const block of blocks.slice(1)) {
        expect(zeroingRulesFor(block).length, `${name}: ${block.tagName} below the first`).toBe(0);
      }
    }
  });

  it('the margin it removes is the one the block otherwise carries', () => {
    // Joins the two halves: the shipped sheet gives this element a top margin,
    // and the last value reaching it is the zero of the rule above. Read in
    // stylesheet order, which is how the cascade would resolve it.
    const heading = blocksOf(SHAPES[0][1])[0];
    const values = valuesReaching(rules, heading, 'margin');
    expect(values.length).toBeGreaterThan(0);
    expect(valuesReaching(rules, heading, 'margin-top').at(-1)).toBe('0');
  });
});
