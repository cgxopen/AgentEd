/**
 * #380 — the files in `assets/` the open document does not use, greyed in the
 * files panel, from the one answer the «Images» popover counts with.
 *
 * **Said first: the grey is not observable here; which files are marked is.**
 * The tree is the one `setupSidebar` draws from the shipped markup, filled by
 * `refreshSidebar` over a folder held in a stub, and the document is a real
 * editor. What these rows cannot see is how the grey looks, which is the owner
 * pass in all seven palettes; the rule that draws it is read out of the sheet
 * and run against the entry the tree drew.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import type { EntryPresence, FileEntry, PlatformIO } from '../platform/types';
import stylesCss from '../styles.css?raw';
import { shippedElement } from '../test-support/shipped-markup';
import { reaches, stylesheetRules, valuesReaching } from '../test-support/stylesheet-rules';
import { contrast, paletteTokens, resolveColour } from '../test-support/theme-colours';
import { documentReferencesImage } from '../ui/document-badges';
import { type Sidebar, setupSidebar } from '../ui/sidebar';
import { NOT_USED_HERE, UNUSED_CLASS } from '../ui/sidebar-tree';
import { summariseAssets, unusedAssetFiles } from './assets-summary';
import { refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

// The desktop, where every file of the tree is an entry that opens (R-C6).
vi.mock('../platform/detect', () => ({ isTauri: true }));

const DOC = '/doc/note.md';
const FILES = ['cover.png', 'diagram.png', 'old-draft.png', 'screenshot-2.png'];
const USED = ['cover.png', 'diagram.png'];
const UNUSED = ['old-draft.png', 'screenshot-2.png'];
/** Two used images, spelled two ways a file spells them. */
const DOCUMENT = '# Notes\n\n![cover](assets/cover.png)\n\n![diagram](./assets/diagram.png)\n';

let listing: (dir: string) => Promise<FileEntry[]>;

const io = {
  canWriteCompanions: async () => true,
  entryPresence: async (path: string): Promise<EntryPresence> =>
    path === '/doc/assets' ? 'present' : 'absent',
  listDir: (dir: string) => listing(dir),
} as unknown as PlatformIO;

let instance: EditorInstance;
let host: HTMLElement;
let sidebar: Sidebar;
let state: AppState;

beforeEach(() => {
  listing = async (dir) =>
    FILES.map((name) => ({ name, path: `${dir}/${name}`, isDirectory: false }));
  document.body.innerHTML = shippedElement(shippedPage, '<aside id="sidebar"');
  sidebar = setupSidebar();
  host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(DOCUMENT);
  state = new AppState();
  state.filePath = DOC;
});

afterEach(() => {
  instance.destroy();
  host.remove();
  document.body.innerHTML = '';
});

/** What `main.ts` runs after every draw of the panel and every change to the document. */
function mark(): void {
  sidebar.markUnused(unusedAssetFiles(instance.editor, state.filePath));
}

async function drawAndMark(): Promise<void> {
  // The #402 half of the same wiring: the panel is derived from content,
  // so `main.ts` writes this from the same predicate the badge is drawn
  // from, on every transaction. Restated here rather than imported, the
  // way `document-badges-flow.test.ts` restates the badge wiring.
  state.referencesImage = documentReferencesImage(instance.editor);
  await refreshSidebar(state, sidebar, io);
  mark();
}

function entry(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('.sidebar-file-entry')].find((el) =>
    el.textContent?.endsWith(name),
  );
  if (!found) throw new Error(`the tree drew no ${name}`);
  return found;
}

const marked = () =>
  [...document.querySelectorAll<HTMLElement>(`.${UNUSED_CLASS}`)].map((el) =>
    el.textContent?.split(' ').at(-1),
  );

describe('the panel greys what the document does not use (#380)', () => {
  it.each(USED)('leaves %s, which the document uses, as it was', async (name) => {
    await drawAndMark();
    expect(entry(name).classList.contains(UNUSED_CLASS)).toBe(false);
    expect(entry(name).title).toBe(name);
  });

  it.each(UNUSED)('greys %s, which it does not use', async (name) => {
    await drawAndMark();
    expect(entry(name).classList.contains(UNUSED_CLASS)).toBe(true);
  });

  it('says why on the tooltip of a greyed file, below its name', async () => {
    await drawAndMark();
    for (const name of UNUSED) expect(entry(name).title).toBe(`${name}\n${NOT_USED_HERE}`);
  });

  it('takes the mark off the moment the document uses the file', async () => {
    await drawAndMark();
    instance.setMarkdown(`${DOCUMENT}\n![draft](assets/old-draft.png)\n`);
    mark();
    expect(marked()).toEqual(['screenshot-2.png']);
    expect(entry('old-draft.png').title).toBe('old-draft.png');
  });
});

describe('where use cannot be established, nothing is marked (#380)', () => {
  it('marks nothing beside a document never saved', async () => {
    await drawAndMark();
    state.filePath = null;
    mark();
    expect(marked()).toEqual([]);
  });

  it('marks nothing when the folder cannot be read', async () => {
    listing = async () => {
      throw new Error('EACCES');
    };
    await drawAndMark();
    expect(marked()).toEqual([]);
  });

  it('marks nothing outside the assets folder beside this document', () => {
    const unused = unusedAssetFiles(instance.editor, DOC);
    expect(unused('/doc/other/old-draft.png')).toBe(false);
    expect(unused('/elsewhere/assets/old-draft.png')).toBe(false);
    expect(unused('/doc/assets/old-draft.png')).toBe(true);
  });
});

/**
 * The shapes the step zero measured, each with what it references and the
 * file in `assets/` that answers for it. The popover used to compare names.
 */
const SHAPES: ReadonlyArray<
  readonly [shape: string, markdown: string, file: string, used: boolean]
> = [
  ['a plain reference', '![a](assets/a.png)', 'a.png', true],
  ['a reference from ./', '![b](./assets/b.png)', 'b.png', true],
  ['an HTML image (#27)', '<img src="assets/c.png" width="100">', 'c.png', true],
  ['a name with a space, spelled %20', '![p](assets/my%20pic.png)', 'my pic.png', true],
  ['a name in other capitals, on Windows', '![g](Assets/G.PNG)', 'g.png', true],
  ['the same name in another folder', '![e](other/e.png)', 'e.png', false],
  ['the same name at a web address', '![f](https://example.com/f.png)', 'f.png', false],
];

describe('one answer, read by the popover and the panel (#380)', () => {
  it.each(
    SHAPES,
  )('%s: the popover and the panel give the one answer', async (_shape, markdown, file, used) => {
    const doc = file === 'g.png' ? 'C:/doc/note.md' : DOC;
    const dir = doc.replace('note.md', 'assets');
    instance.setMarkdown(markdown);
    const unused = unusedAssetFiles(instance.editor, doc);
    expect(unused(`${dir}/${file}`)).toBe(!used);

    const popover = await summariseAssets(instance.editor, doc, {
      entryPresence: async () => 'present',
      listDir: async () => [{ name: file, path: `${dir}/${file}`, isDirectory: false }],
    } as unknown as PlatformIO);
    expect(popover.folder).toEqual({ kind: 'counted', otherFiles: used ? 0 : 1 });
  });

  it('the popover counts exactly the files the panel greys', async () => {
    await drawAndMark();
    const popover = await summariseAssets(instance.editor, DOC, io);
    expect(popover.folder).toEqual({ kind: 'counted', otherFiles: marked().length });
  });
});

const rules = stylesheetRules(stylesCss);
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
const palettes = paletteTokens(rules);

function inHover(el: Element, property: string): string[] {
  return atEveryWidth
    .filter((rule) => rule.selector.includes(':hover'))
    .filter((rule) => reaches(rule.selector.replaceAll(':hover', ''), el))
    .filter((rule) => rule.declarations.has(property))
    .map((rule) => rule.declarations.get(property) as string);
}

describe('the grey, as the sheet draws it (#380)', () => {
  it('draws a greyed name in --muted, and in --text under the pointer', async () => {
    await drawAndMark();
    const grey = entry('old-draft.png');
    expect(valuesReaching(atEveryWidth, grey, 'color').at(-1)).toBe('var(--muted)');
    expect(inHover(grey, 'color').at(-1)).toBe('var(--text)');
    expect(valuesReaching(atEveryWidth, entry('cover.png'), 'color')).toEqual([]);
  });

  it('leaves an inert entry with no hover at all (R-C6)', async () => {
    await drawAndMark();
    const grey = entry('old-draft.png');
    grey.classList.add('sidebar-file-inert');
    expect(inHover(grey, 'color')).toEqual([]);
  });

  it.each([...palettes.keys()])('%s: a greyed name reads at 4.5 on the card', async (name) => {
    await drawAndMark();
    const tokens = palettes.get(name) as Map<string, string>;
    const card = resolveColour(
      valuesReaching(atEveryWidth, document.getElementById('sidebar') as Element, 'background').at(
        -1,
      ) as string,
      tokens,
    );
    const ink = valuesReaching(atEveryWidth, entry('old-draft.png'), 'color').at(-1) as string;
    expect(contrast(resolveColour(ink, tokens), card), name).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ...palettes.keys(),
  ])('%s: the note of an empty answer reads at 4.5, in --muted', (name) => {
    // The `.sidebar-note` debt of #358, paid here: it named `--text-muted`,
    // which no palette defines.
    const tokens = palettes.get(name) as Map<string, string>;
    const note = atEveryWidth.find((rule) => rule.selector === '.sidebar-note');
    expect(note?.declarations.get('color')).toBe('var(--muted)');
    expect(note?.declarations.has('opacity')).toBe(false);
    const card = resolveColour('var(--bg)', tokens);
    expect(contrast(resolveColour('var(--muted)', tokens), card), name).toBeGreaterThanOrEqual(4.5);
  });
});
