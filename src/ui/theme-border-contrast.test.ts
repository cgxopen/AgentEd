/**
 * Issue #321 — the border token could not draw a control, and one button had no
 * label colour at all.
 *
 * **Said at the head, because it is the limit of every row below: colour is not
 * observable in this harness.** happy-dom performs no layout and paints
 * nothing. What these rows establish is the value a rule computes to in each
 * palette and the element that rule reaches — never how a 1 px line looks, how
 * an outline reads at a glance, or what WebView2 makes of either. That is the
 * owner pass on the artifact, in all seven palettes.
 *
 * **Why the two halves are always joined.** A row asserting that
 * `.header-edge-button` declares `border: 1px solid var(--border)` passed on
 * every head while that border was the same hex as the surface under it and no
 * outline was drawn at all. A row asserting the token is `#909090` would pin a
 * number nobody can check against anything. So each row below reads the
 * declaration **out of the sheet**, runs its selector against the element the
 * page actually carries, resolves the value in each palette, and asserts the
 * ratio against the ground that element sits on. Either half alone asserts
 * nothing; this is the shape #319 built for the floating toolbar.
 *
 * **The second class these rows cover, and why it is here.** The step zero of
 * #321 inventoried every rule that names `--accent` and every rule that names
 * `--border`, and found 24 of one and 31 of the other. A control whose colour
 * is simply *absent* is in neither set, which is how `.dialog-actions button`
 * shipped a label at 1.11 to 1 in GitHub Dark while 24 accent rows were being
 * counted. The last describe is written for the gap rather than for that one
 * rule: it asks of every control the page renders that **some** rule in the
 * sheet gives it a colour, so the browser default can never be what a label
 * falls through to again.
 */
import { afterEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import stylesCss from '../styles.css?raw';
import { reaches, stylesheetRules } from '../test-support/stylesheet-rules';
import {
  contrast,
  over,
  paletteTokens,
  type Rgba,
  resolveColour,
} from '../test-support/theme-colours';
import { showConfirmDialog } from './confirm-dialog';

/** WCAG 1.4.11: visual information required to identify a control. */
const NON_TEXT = 3;
/** WCAG 1.4.3 for text of this size — 13 px at weight 400 is not large text. */
const TEXT = 4.5;

const rules = stylesheetRules(stylesCss);
/**
 * The rules that apply at every window width. A `@media` block in this sheet
 * changes what collapses out of the header, never a colour.
 */
const atEveryWidth = rules.filter((rule) => rule.conditions.length === 0);
const palettes = paletteTokens(rules);
const paletteNames = [...palettes.keys()];

afterEach(() => {
  document.body.innerHTML = '';
});

/**
 * The value the last rule reaching `target` gives `property`, in stylesheet
 * order. Not the cascade: it agrees with it wherever the later rule is at
 * least as specific as those before it, which holds for every element below.
 */
function declared(target: Element, property: string): string | null {
  let value: string | null = null;
  for (const rule of atEveryWidth) {
    if (!reaches(rule.selector, target)) continue;
    const shorthand = property === 'border-color' ? rule.declarations.get('border') : undefined;
    if (shorthand !== undefined) value = colourOf(shorthand);
    const own = rule.declarations.get(property);
    if (own !== undefined) value = property === 'background' ? (colourOf(own) ?? own) : own;
  }
  return value;
}

/**
 * The colour inside a shorthand such as `1px solid var(--border)`. The sheet
 * writes every border colour as a `var()` or a hex, so those are the two forms
 * read; anything else answers `null` rather than a guess, and the row that
 * asked then fails on a null instead of passing on a misread value.
 */
function colourOf(shorthand: string): string | null {
  return /var\(--[\w-]+\)|#[0-9a-f]{3,8}\b/i.exec(shorthand)?.[0] ?? null;
}

/** A colour expression painted over a stack of grounds, bottom first. */
function paint(tokens: ReadonlyMap<string, string>, layers: readonly string[]): Rgba {
  let out = resolveColour(layers[0], tokens);
  for (const layer of layers.slice(1)) out = over(resolveColour(layer, tokens), out);
  return out;
}

/** The page's `<header>`; mounting the document would send happy-dom fetching. */
function mountShippedHeader(): void {
  const open = shippedPage.indexOf('<header id="menubar">');
  const close = shippedPage.indexOf('</header>');
  if (open < 0 || close < 0) throw new Error('index.html no longer has a #menubar header');
  document.body.innerHTML = shippedPage.slice(open, close + '</header>'.length);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped header has no #${id}`);
  return found;
}

describe('the border token can draw a control in every palette (#321)', () => {
  it('reads seven palettes and a border value for each', () => {
    expect(paletteNames).toHaveLength(7);
    for (const tokens of palettes.values()) {
      expect(tokens.get('--border')).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(paletteNames)('%s: the border stands off the surface it is drawn on', (name) => {
    const tokens = palettes.get(name)!;
    // `--surface` is the ground that binds in every palette: a light palette's
    // `--bg` is lighter than its surface and a dark palette's is darker, so the
    // surface is the harder of the two either way. The row below holds `--bg`.
    const ratio = contrast(paint(tokens, ['var(--border)']), paint(tokens, ['var(--surface)']));
    expect(ratio).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it.each(paletteNames)('%s: and off the page behind it', (name) => {
    const tokens = palettes.get(name)!;
    const ratio = contrast(paint(tokens, ['var(--border)']), paint(tokens, ['var(--bg)']));
    expect(ratio).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

/**
 * The seven members of the menubar family (#332). Their outline is the whole of
 * what says they can be pressed, so it is the row 1.4.11 is about.
 */
const MENUBAR_FAMILY = [
  'menu-toggle',
  'spellcheck-toggle',
  'indicator-search',
  'badge-images',
  'cluster-indicator',
  'overflow-toggle',
  'appearance-menu-trigger',
];

describe('the outline that means pressable is drawn in every palette (#332, #321)', () => {
  it('every member of the family takes its outline from the sheet', () => {
    mountShippedHeader();
    for (const id of MENUBAR_FAMILY) {
      expect(declared(element(id), 'border-color')).toBe('var(--border)');
    }
  });

  it('the bar under them is a surface the sheet names', () => {
    mountShippedHeader();
    expect(declared(element('menubar'), 'background')).toBe('var(--surface)');
  });

  it.each(paletteNames)('%s: the outline stands off the bar it is drawn on', (name) => {
    mountShippedHeader();
    const tokens = palettes.get(name)!;
    const bar = declared(element('menubar'), 'background');
    if (bar === null) throw new Error('no rule gives the menubar a background');
    for (const id of MENUBAR_FAMILY) {
      const outline = declared(element(id), 'border-color');
      if (outline === null) throw new Error(`no rule gives #${id} a border colour`);
      const ratio = contrast(paint(tokens, [outline]), paint(tokens, ['var(--bg)', bar]));
      expect(ratio, `#${id} in ${name}`).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });
});

/** What one dialog button is dressed with, read out of the sheet. */
interface Dressed {
  readonly label: string;
  readonly colour: string | null;
  readonly fill: string | null;
}

/**
 * Render the real dialog, read what the sheet gives each button, and close it
 * again — **all of it before any row asserts**.
 *
 * `showConfirmDialog` keeps one module-level `activeDialog` and refuses a
 * second while one is open. A row that asserted with the dialog still on screen
 * would leave it open when it failed, and every row after it would then be
 * handed a dialog with no buttons and fail for a reason that is not its own.
 * Met while writing these rows, which is why the reading and the asserting are
 * separated rather than interleaved.
 */
async function dressedDialogButtons(): Promise<Dressed[]> {
  const done = showConfirmDialog({
    title: 'Unsaved changes',
    message: 'Save before closing?',
    actions: [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Discard', value: 'discard', variant: 'danger' },
      { label: 'Save', value: 'save', variant: 'primary' },
    ],
  });
  await Promise.resolve();
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.dialog-actions button'),
  );
  if (buttons.length !== 3) throw new Error(`the dialog rendered ${buttons.length} buttons`);
  const dressed = buttons.map((button) => ({
    label: button.textContent ?? '',
    colour: declared(button, 'color'),
    fill: declared(button, 'background'),
  }));
  buttons[0].click();
  await done;
  return dressed;
}

/**
 * The buttons whose label this issue repairs: the plain ones, which had no
 * `color` at all.
 *
 * **`Save` and `Discard` are deliberately outside the ratio row**, and the
 * figures rather than the omission are the record. They carry `#fff` on
 * `--accent` and on `--danger`, which measures **2.53 to 5.19** and **3.35 to
 * 5.90** across the seven palettes — below 4.5 in five palettes for the first
 * and in two for the second. Both are rows the step zero of #321 measured and
 * the owner declined on 2026-09-17, preferring the accents as they ship. A row
 * here asserting they pass would be red on a head nobody means to change, and a
 * row asserting the failing figures would pin the defect in place; so the
 * colour they carry is asserted to exist, with its ratio left to whatever issue
 * takes that decision up again.
 */
const REPAIRED = 'Cancel';

describe('every control the sheet draws carries a label colour (#321)', () => {
  it('every dialog button takes a colour from the sheet rather than from the browser', async () => {
    for (const button of await dressedDialogButtons()) {
      expect(button.colour, button.label).not.toBeNull();
      expect(button.fill, button.label).not.toBeNull();
    }
  });

  it.each(paletteNames)('%s: and on the plain button that colour is readable', async (name) => {
    const dressed = await dressedDialogButtons();
    const tokens = palettes.get(name)!;
    const plain = dressed.filter((button) => button.label === REPAIRED);
    expect(plain).toHaveLength(1);
    for (const button of plain) {
      if (button.colour === null || button.fill === null) {
        throw new Error(`the sheet leaves ${button.label} undressed`);
      }
      const under = paint(tokens, ['var(--bg)', button.fill]);
      const ratio = contrast(over(resolveColour(button.colour, tokens), under), under);
      expect(ratio, `${button.label} in ${name}`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  /**
   * The sweep the step zero of #321 did not do, and the reason that issue got a
   * 1.11 past an inventory of 55 rules. It asks nothing about which colour —
   * only that a control the page renders is dressed by this sheet rather than
   * by whatever `ButtonText` resolves to in the host browser. Nothing here
   * declares `color-scheme`, so that keyword is black in every palette.
   *
   * **Scoped to what a test can mount**: the shipped header, and the dialog
   * above. A control on a surface no row renders is not covered, which is a
   * limit of the sweep rather than a claim about the sheet.
   */
  it('no control in the shipped header falls through to the browser default', () => {
    mountShippedHeader();
    const controls = document.querySelectorAll<HTMLElement>('button, input, select, textarea');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(declared(control, 'color'), control.id || control.className).not.toBeNull();
    }
  });
});

/**
 * The half of #332 that is deliberately left below the floor, pinned so that
 * leaving it there stays a decision rather than becoming an oversight.
 *
 * A readout is filled rather than outlined, and the fill measures about 1.1
 * against the bar. The owner took that on 2026-09-17: a readout quieter than a
 * button is what the rule is for. This row states the shape — the fill is an
 * overlay the sheet names — and asserts no ratio, because there is no floor
 * here to assert.
 */
describe('the filled half of the menubar rule is unchanged (#332)', () => {
  it('a readout is filled with the overlay, not outlined', () => {
    mountShippedHeader();
    const readout = element('count-readout');
    expect(declared(readout, 'background')).toBe('var(--hover-overlay)');
    expect(declared(readout, 'border-color')).toBeNull();
  });
});
