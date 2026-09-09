import { afterEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { createEditor, type EditorInstance } from './setup';

/**
 * Issue #262 - levels 5 and 6 are in the schema, and their markers stay in
 * the file.
 *
 * **The half of this that no test can observe comes first.** Whether the
 * ladder reads as a ladder on screen, and whether level 6 is told apart from
 * level 5 by its colour, is layout and perception. Nothing here can see it,
 * and the owner run named on the pull request is where it is verified rather
 * than confirmed. What is asserted instead is the join: the rules are read
 * out of `src/styles.css` rather than restated, and run against the elements
 * the editor actually rendered. Either half alone asserts nothing - a test
 * that spells the selector again passes while the sheet says something else,
 * and a rule reaching nothing is not a failure anyone would see.
 *
 * The defect itself is one assertion, and the two that make it mean anything
 * are the ones that pass: levels 1 to 4 unchanged, and a seventh hash still
 * not a heading.
 */

let instance: EditorInstance | null = null;
afterEach(() => {
  instance?.destroy();
  instance = null;
});

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** Every rule in the sheet, as a selector and the declarations under it. */
function allRules(): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  for (const block of stylesCss.split('}')) {
    const brace = block.lastIndexOf('{');
    if (brace === -1) continue;
    const selector =
      block
        .slice(0, brace)
        .split('\n')
        .filter((line) => line.trim() !== '')
        .pop() ?? '';
    rules.push({ selector: selector.trim(), body: block.slice(brace + 1) });
  }
  return rules;
}

const ruleFor = (selector: string) => allRules().find((r) => r.selector === selector);

// ─────────────────────────────────────────────────────────────────────────────
// The defect
// ─────────────────────────────────────────────────────────────────────────────

describe('a file carrying levels 5 and 6 keeps them (#262)', () => {
  const SOURCE = '# one\n\nordinary text\n\n##### five\n\n###### six\n\nmore text\n';

  it('opens both as headings rather than as paragraphs', () => {
    const html = editorWith(SOURCE).editor.getHTML();
    expect(html).toContain('<h5');
    expect(html).toContain('<h6');
  });

  it('saves byte-identical, which is the whole of the defect', () => {
    expect(editorWith(SOURCE).getMarkdown()).toBe(SOURCE.trimEnd());
  });

  it('and a second save moves nothing', () => {
    const first = editorWith(SOURCE).getMarkdown();
    expect(editorWith(first).getMarkdown()).toBe(first);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The halves that give it meaning
// ─────────────────────────────────────────────────────────────────────────────

describe('the levels that were already there are untouched (#262)', () => {
  it.each([
    ['# One', '<h1'],
    ['## Two', '<h2'],
    ['### Three', '<h3'],
    ['#### Four', '<h4'],
  ])('%s still opens as a heading', (markdown, tag) => {
    expect(editorWith(markdown).editor.getHTML()).toContain(tag);
    expect(editorWith(markdown).getMarkdown()).toBe(markdown);
  });
});

describe('the levels stop where CommonMark stops (#262)', () => {
  it('a seventh hash is not a heading', () => {
    // The assertion a widened pattern would fail. The input rules and the
    // parse rules are both built from the levels list, so the ceiling is
    // named rather than matched loosely - and this is what says so.
    const html = editorWith('####### seven').editor.getHTML();
    expect(html).not.toContain('<h7');
    expect(html).toContain('<p');
  });

  it('and its text survives as text rather than being eaten', () => {
    expect(editorWith('####### seven').getMarkdown()).toContain('seven');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The stylesheet, joined to what the editor rendered
// ─────────────────────────────────────────────────────────────────────────────

describe('the two new rules exist and reach the elements (#262)', () => {
  it.each([
    ['.tiptap h5', '##### five', 'h5'],
    ['.tiptap h6', '###### six', 'h6'],
  ])('%s is in the sheet and matches what is rendered', (selector, markdown, tag) => {
    const rule = ruleFor(selector);
    expect(rule, `no rule in styles.css for ${selector}`).toBeDefined();

    // The other direction: the selector the sheet carries, run against the
    // element the editor built. A rule reaching nothing is not a failure
    // anyone sees.
    const host = document.createElement('div');
    document.body.appendChild(host);
    instance = createEditor(host);
    instance.setMarkdown(markdown);
    const rendered = host.querySelector(selector);
    expect(rendered, `${selector} matched nothing the editor rendered`).not.toBeNull();
    expect(rendered?.tagName.toLowerCase()).toBe(tag);
    host.remove();
  });

  it('level 6 is the one that carries a colour, which is how it is told from level 5', () => {
    // The distinction the owner run looks for. The sizes are equal on purpose
    // - the band between level 4 and body text is too narrow for two more
    // steps - so colour is what separates the last pair. Asserted from the
    // sheet rather than restated: the declaration is read, not spelled.
    expect(ruleFor('.tiptap h5')?.body).not.toContain('color:');
    expect(ruleFor('.tiptap h6')?.body).toContain('color: var(--muted)');
  });

  it('neither rule reaches the file', () => {
    // R-C2: appearance is not content. Whatever the sheet says, the bytes are
    // the markers and nothing else.
    const saved = editorWith('##### five\n\n###### six').getMarkdown();
    expect(saved).toBe('##### five\n\n###### six');
    expect(saved).not.toContain('color');
    expect(saved).not.toContain('font-weight');
  });
});
