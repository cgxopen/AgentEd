/**
 * Issue #321 — the border token could not draw a control, and one button had no
 * label colour at all.
 *
 * **Said at the head, because it is the limit of every row below: colour is not
 * observable in this harness.** happy-dom performs no layout and paints
 * nothing. What these rows establish is the value a rule computes to in each
 * palette and the element that rule reaches — never how a 1 px line looks, how
 * an outline reads at a glance, or what WebView2 makes of either. That is the
 * owner pass on the artifact, in all six palettes.
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
 * shipped a label at 1.11 to 1 in the GitHub Dark that left at #398, while 24
 * accent rows were being counted. The last describe is written for the gap rather than for that one
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
 * writes every border colour as a `var()`, a hex or, since #368 made the header
 * controls transparent at rest, the keyword `transparent`, so those are the
 * three forms read; anything else answers `null` rather than a guess, and the
 * row that asked then fails on a null instead of passing on a misread value.
 */
function colourOf(shorthand: string): string | null {
  return /var\(--[\w-]+\)|#[0-9a-f]{3,8}\b|\btransparent\b/i.exec(shorthand)?.[0] ?? null;
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
  it('reads six palettes and a border value for each', () => {
    // Seven until #398 took the GitHub pair out and put OLED Black in.
    expect(paletteNames).toHaveLength(6);
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
 * Every pressable member of the menubar family: the six of #332 and the files
 * panel control, which took the last seat at #347.
 */
const MENUBAR_FAMILY = [
  'menu-toggle',
  'indicator-search',
  'badge-images',
  'overflow-toggle',
  'appearance-menu-trigger',
  'sidebar-toggle',
];

/** The two readouts of the bar: the run of counts and the «Metadata» badge. */
const READOUTS = ['count-readout', 'badge-metadata'];

/**
 * The outline that said pressable from #332, and the 3 to 1 it was held to at
 * #321, were retired at #368 (owner decision of 2026-09-18): at rest every
 * header control is transparent. The border token keeps its floor above,
 * because panels, cards and fields still draw with it.
 */
describe('every header control is transparent at rest (#368)', () => {
  it('the bar under them is the page colour the sheet names (#351)', () => {
    mountShippedHeader();
    expect(declared(element('menubar'), 'background')).toBe('var(--bg)');
  });

  it('no member of the family draws a border or a fill', () => {
    mountShippedHeader();
    for (const id of MENUBAR_FAMILY) {
      expect(declared(element(id), 'border-color'), id).toBe('transparent');
      expect(declared(element(id), 'background'), id).toBe('none');
    }
  });

  it('no readout draws a border or a fill', () => {
    mountShippedHeader();
    for (const id of READOUTS) {
      expect(declared(element(id), 'border-color'), id).toBeNull();
      expect(declared(element(id), 'background'), id).toBe('none');
    }
  });

  /**
   * The labels a readout holds in `--muted`: the word and character counts and
   * the «Metadata» badge. Until #368 they sat on the readout fill, where they
   * measured 4.31 in paper and 4.43 in light; on the bar they are text on the
   * page colour, and this row holds them there at the 4.5 they need.
   */
  it.each(paletteNames)('%s: the muted labels of the readouts are readable on the bar', (name) => {
    mountShippedHeader();
    const tokens = palettes.get(name)!;
    const bar = declared(element('menubar'), 'background');
    if (bar === null) throw new Error('no rule gives the menubar a background');
    for (const id of ['word-count', 'char-count', 'badge-metadata']) {
      const el = element(id);
      const colour = declared(el, 'color');
      expect(colour, id).toBe('var(--muted)');
      const fill = declared(el.closest('.header-readout') ?? el, 'background') ?? 'none';
      const under = paint(tokens, ['var(--bg)', bar, fill]);
      const ratio = contrast(resolveColour(colour as string, tokens), under);
      expect(ratio, `#${id} in ${name}`).toBeGreaterThanOrEqual(TEXT);
    }
  });
});

/**
 * **An accepted exception, and the figures it was accepted at** (owner, on
 * #368, 2026-09-18). A lit control, one whose surface is open, is filled with
 * `--hover-overlay-strong`, and that fill measures **1.165 to 1.429** against
 * the bar and **1.08 to 1.21** against the pressed shade across the seven
 * palettes: below the 3 to 1 a state indicator is held to, in all seven. No form
 * the tokens allow reaches it as a difference between states, which the step
 * zero of #368 measured, and the owner kept this one over a new token.
 *
 * The same shape as the Save and Discard rows below, which are accepted too:
 * a row asserting 3 to 1 would be red on a head nobody means to change. The
 * rows here hold the accepted figures **as a floor** instead, so a value edited
 * to something quieter than what was accepted turns red rather than widening
 * the exception without a decision.
 */
describe('the lit state is an accepted exception below 3 to 1 (#368)', () => {
  /** The floors, the lowest figure of each measurement at acceptance, to two decimals. */
  const LIT_AGAINST_BAR = 1.16;
  const LIT_AGAINST_PRESSED = 1.08;

  /** The shade the sheet gives `id` while its surface is open, and while it is pressed. */
  function shades(id: string): { lit: string; pressed: string } {
    const el = element(id);
    el.setAttribute('aria-expanded', 'true');
    const lit = declared(el, 'background-color');
    el.setAttribute('aria-expanded', 'false');
    const pressed = atEveryWidth
      .filter((rule) => rule.selector.includes(':active'))
      .filter((rule) => reaches(rule.selector.replaceAll(':active', ''), el))
      .map((rule) => rule.declarations.get('background-image'))
      .filter((value) => value !== undefined)
      .at(-1);
    if (lit === null || pressed === undefined)
      throw new Error(`#${id} has no lit or no pressed shade`);
    return { lit, pressed };
  }

  it.each(
    paletteNames,
  )('%s: lit stands off the bar and off pressed by what was accepted', (name) => {
    mountShippedHeader();
    const tokens = palettes.get(name)!;
    const bar = declared(element('menubar'), 'background');
    if (bar === null) throw new Error('no rule gives the menubar a background');
    for (const id of MENUBAR_FAMILY) {
      const { lit, pressed } = shades(id);
      const ground = paint(tokens, ['var(--bg)', bar]);
      const litOnBar = paint(tokens, ['var(--bg)', bar, lit]);
      const pressedOnBar = paint(tokens, ['var(--bg)', bar, pressed]);
      const againstBar = contrast(litOnBar, ground);
      const againstPressed = contrast(litOnBar, pressedOnBar);
      expect(againstBar, `#${id} lit against the bar in ${name}`).toBeGreaterThanOrEqual(
        LIT_AGAINST_BAR,
      );
      expect(againstPressed, `#${id} lit against pressed in ${name}`).toBeGreaterThanOrEqual(
        LIT_AGAINST_PRESSED,
      );
      // Stated rather than implied: this is the exception, not a pass.
      expect(againstBar, `#${id} in ${name}`).toBeLessThan(NON_TEXT);
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
