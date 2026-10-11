import { Marked } from 'marked';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeLinkUrl } from './link-url';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * Content a file holds inert stays inert through an AgentEd save (#447).
 *
 * Found by the section B readings on #20, sections 1 and 3 of comment
 * 5925655575, where each reproduction below was measured: an untouched save
 * turned an entity in a link destination into a `javascript:` link (F2), an
 * image tag carried inside a hand-written `data-html-source` into a live tag
 * with an event handler (F3), and the entries of a hand-written
 * `data-footnote-indents` into a heading or a live tag (F4). Nothing ran
 * inside AgentEd in any of them; what changed was the file, for the next
 * renderer that does not sanitize.
 *
 * "Live" is asked of a pristine `marked`, which sanitizes nothing: the saved
 * file holds no event handler and no link that resolves to `javascript:` or
 * `data:`. "Holds still" is the second save writing what the first wrote.
 */

const pristine = new Marked();
const E = encodeURIComponent;
const LIVE = '<img src=x onerror=alert(1)>';

let open: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  open.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of open) instance.destroy();
  open = [];
  document.body.innerHTML = '';
});

/** What a renderer with no sanitizer makes of `markdown`, as a DOM. */
function rendered(markdown: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = String(pristine.parse(markdown));
  return container;
}

/** Every way the saved file is live in a renderer that does not sanitize. */
function liveIn(markdown: string): string[] {
  const found: string[] = [];
  for (const element of Array.from(rendered(markdown).querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) found.push(`${element.tagName} ${attribute.name}`);
    }
    const href = element.getAttribute('href');
    if (href !== null && /^\s*(javascript|vbscript|data):/i.test(href)) found.push(`href ${href}`);
  }
  return found;
}

/** The first save, and the save after reopening it. */
function twoSaves(first: EditorInstance): { saved: string; again: string } {
  const saved = first.getMarkdown();
  const again = editorWith(saved).getMarkdown();
  return { saved, again };
}

describe('F2: an entity in a link destination stays text', () => {
  it.each([
    ['a named entity for the colon', 'javascript&amp;colon;alert(1)', 'javascript&colon;alert(1)'],
    [
      'a numeric entity for the first letter',
      '&amp;#106;avascript:alert(1)',
      '&#106;avascript:alert(1)',
    ],
    ['a named entity in a data address', 'data&amp;colon;text/html,x', 'data&colon;text/html,x'],
  ])('a raw anchor holding %s', (_label, attribute, href) => {
    const { saved, again } = twoSaves(editorWith(`before <a href="${attribute}">t</a> after\n`));
    expect(liveIn(saved)).toEqual([]);
    expect(again).toBe(saved);
    // The destination the file held is still the destination on reopen.
    expect(editorWith(saved).editor.getHTML()).toContain(`href="${href.replace(/&/g, '&amp;')}"`);
  });

  it('the link dialog, typed with a named entity', () => {
    const instance = editorWith('word');
    instance.editor.commands.setTextSelection({ from: 1, to: 5 });
    instance.editor.chain().setLink({ href: 'javascript&colon;alert(1)' }).run();
    const { saved, again } = twoSaves(instance);
    expect(liveIn(saved)).toEqual([]);
    expect(again).toBe(saved);
    expect(editorWith(saved).editor.getHTML()).toContain('href="javascript&amp;colon;alert(1)"');
  });

  it('the neighbour: the dialog refuses a control character, as it refuses whitespace', () => {
    expect(normalizeLinkUrl('java\u0000script:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('https://example.com/a\u0001')).toBeNull();
  });
});

describe('F3: a hand-written data-html-source is not the bytes of the file', () => {
  const carried = `data-html-source="${E(LIVE)}"`;
  it.each([
    ['first', `<img ${carried} src="a.png" alt="a">\n`],
    ['last', `<img src="a.png" alt="a" ${carried}>\n`],
    ['inside a paragraph', `text <img ${carried} src="a.png" alt="a"> text\n`],
  ])('the attribute placed %s: the file is written back as it was', (_label, file) => {
    const { saved, again } = twoSaves(editorWith(file));
    expect(saved).toBe(file.trimEnd());
    expect(liveIn(saved)).toEqual([]);
    expect(again).toBe(saved);
  });
});

describe('F4: a hand-written data-footnote-indents writes no markup', () => {
  const definition = (entries: string[]) =>
    `<div data-footnote-definition data-footnote-indents="${E(JSON.stringify(entries))}">[^a]: one<br>two</div>\n`;

  it('an entry holding a heading', () => {
    const { saved, again } = twoSaves(editorWith(definition(['\n# Injected heading\n'])));
    expect(rendered(saved).querySelector('h1')).toBeNull();
    expect(again).toBe(saved);
  });

  it('an entry holding a raw tag', () => {
    const { saved, again } = twoSaves(editorWith(definition([`\n\n${LIVE}\n\n`])));
    expect(liveIn(saved)).toEqual([]);
    expect(again).toBe(saved);
  });
});

/**
 * The comment carrier the readings missed (#447 step zero): the readings tried
 * `data-comment` on a `span`, and the carrier is a `wbr`. A file holding one
 * was written back with a real comment where it had an inert attribute value.
 */
describe('a hand-written comment carrier makes no comment', () => {
  it('a wbr carrying data-comment', () => {
    const file = `a <wbr data-comment="${E('<!-- note -->')}"> b\n`;
    const { saved, again } = twoSaves(editorWith(file));
    expect(saved).not.toContain('<!--');
    expect(again).toBe(saved);
  });
});

/**
 * The paste route, which the readings did not reach (#447 step zero). Two
 * ways in: HTML from elsewhere, which `cleanPastedHtml` runs through the
 * serializer and the parser; and HTML carrying `data-pm-slice`, which
 * `isInternalPaste` takes for a copy from this editor and hands to
 * ProseMirror as it is - and which any page can spell.
 */
function pasteHtml(instance: EditorInstance, html: string): void {
  const data: Record<string, string> = { 'text/html': html, 'text/plain': 'x' };
  const event = {
    clipboardData: { types: Object.keys(data), getData: (t: string) => data[t] ?? '', files: [] },
    preventDefault: () => undefined,
  } as unknown as ClipboardEvent;
  const { view } = instance.editor;
  const handled = view.someProp('handlePaste', (handler) =>
    handler(view, event, view.state.selection.content()),
  );
  if (!handled) view.pasteHTML(html);
}

const PASTED: [string, string][] = [
  [
    'an entity in a link destination',
    '<p>before <a href="javascript&amp;colon;alert(1)">t</a> after</p>',
  ],
  [
    'a carried image tag',
    `<p>x <img data-html-source="${E(LIVE)}" src="https://example.com/a.png" alt="a"> y</p>`,
  ],
  [
    'footnote indents holding a heading',
    `<div data-footnote-definition data-footnote-indents="${E(JSON.stringify(['\n# Injected heading\n']))}">[^a]: one<br>two</div>`,
  ],
  [
    'footnote indents holding a raw tag',
    `<div data-footnote-definition data-footnote-indents="${E(JSON.stringify([`\n\n${LIVE}\n\n`]))}">[^a]: one<br>two</div>`,
  ],
];

describe.each([
  ['from elsewhere', (html: string) => html],
  [
    'spelling data-pm-slice',
    (html: string) => html.replace(/^<(\w+)/, '<$1 data-pm-slice="0 0 []"'),
  ],
])('a paste %s', (_route, spell) => {
  it.each(PASTED)('%s writes nothing live and holds still', (_label, html) => {
    const instance = editorWith('');
    pasteHtml(instance, spell(html));
    const { saved, again } = twoSaves(instance);
    expect(liveIn(saved)).toEqual([]);
    expect(rendered(saved).querySelector('h1')).toBeNull();
    expect(again).toBe(saved);
  });
});

/**
 * #563: the marks `sup`, `sub` and `kbd` draw their element with no attribute
 * at all, so an event handler the file put on one is not written back, and
 * nothing a file holds becomes live through them. The raw HTML #563 keeps as
 * bytes is written back as the file had it, so it is live in the saved file
 * exactly where it was live in the file, and nowhere else; and a carrier a file
 * spells by hand is not believed (#447).
 */
describe('#563: the new marks and the kept bytes', () => {
  it.each([
    ['sup', 'The value is 2<sup onclick="alert(1)">n</sup>.\n'],
    ['sub', 'Water is H<sub onmouseover="alert(1)">2</sub>O.\n'],
    ['kbd', 'Press <kbd onfocus="alert(1)">S</kbd>.\n'],
  ])('a %s with an event handler is written with none, and holds still', (_tag, file) => {
    const { saved, again } = twoSaves(editorWith(file));
    expect(liveIn(saved)).toEqual([]);
    expect(saved).toMatch(/<(sup|sub|kbd)>/);
    expect(again).toBe(saved);
  });

  it('kept bytes are live in the saved file only where the file had them live', () => {
    const file = 'Text <span onclick="alert(1)">red</span> here.\n';
    const { saved, again } = twoSaves(editorWith(file));
    expect(liveIn(saved)).toEqual(liveIn(file));
    expect(again).toBe(saved);
  });

  it('a wbr carrying data-raw-html, spelled by the file, writes no markup', () => {
    const file = `a <wbr data-raw-html="${E(LIVE)}"> b\n`;
    const { saved, again } = twoSaves(editorWith(file));
    expect(liveIn(saved)).toEqual([]);
    expect(again).toBe(saved);
  });

  it('an a with an href and text is drawn as a link, never kept as bytes', () => {
    const instance = editorWith('See <a href="javascript&amp;colon;alert(1)">t</a> here.\n');
    const { saved } = twoSaves(instance);
    expect(liveIn(saved)).toEqual([]);
  });
});

/**
 * #563 review: a rich paste keeps no raw HTML as bytes. The page text is written
 * unescaped on its way through the serializer and read again, so text that
 * spelled a tag would come back as that tag; kept as bytes, it reached the file
 * live, measured on `a7a164c`. Elements with no text, an event handler on each.
 */
describe('#563: a rich paste whose page text spells a tag', () => {
  it.each([
    ['a span with an event handler', '<p>&lt;span onclick=alert(1)&gt;&lt;/span&gt; word</p>'],
    ['an svg with an onload', '<p>&lt;svg onload=alert(1)&gt;&lt;/svg&gt; word</p>'],
    ['an unknown element', '<p>&lt;x-thing onmouseover=alert(1)&gt;&lt;/x-thing&gt; word</p>'],
  ])('%s writes nothing live in the saved file', (_label, html) => {
    const instance = editorWith('');
    pasteHtml(instance, html);
    const { saved, again } = twoSaves(instance);
    expect(liveIn(saved)).toEqual([]);
    expect(again).toBe(saved);
  });
});

/**
 * #563, owner decision of 2026-10-11: a plain-text paste keeps no raw HTML as
 * bytes either. It is read as markdown, so text that spelled a tag was kept
 * and reached the file live, with nothing drawn; measured on `451a887`.
 */
describe('#563: a plain-text paste that spells a tag', () => {
  function pastePlain(instance: EditorInstance, text: string): void {
    const event = {
      clipboardData: {
        types: ['text/plain'],
        getData: (t: string) => (t === 'text/plain' ? text : ''),
        files: [],
      },
      preventDefault: () => undefined,
    } as unknown as ClipboardEvent;
    const { view } = instance.editor;
    view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
  }

  it.each([
    ['a span with an event handler', '<span onclick=alert(1)></span> word'],
    ['an svg with an onload', '<svg onload=alert(1)></svg> word'],
  ])('%s writes nothing live in the saved file', (_label, text) => {
    const instance = editorWith('');
    pastePlain(instance, text);
    const { saved, again } = twoSaves(instance);
    expect(liveIn(saved)).toEqual([]);
    expect(saved).toBe('word');
    expect(again).toBe(saved);
  });
});
