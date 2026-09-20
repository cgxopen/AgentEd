/**
 * Issue #319 — the floating toolbar was unreadable in Dark, Solarized Dark and
 * the GitHub Dark that left at #398, and no test could have said so.
 *
 * **The rule that broke was syntactically fine.** `background: var(--text)`
 * reads a theme variable and matches the toolbar; a row asserting that the rule
 * exists passes in every palette. What was wrong was the value it resolved to,
 * a near-white bar under near-white labels, 1.05 to 1 in Dark. So these rows
 * compute: they read each palette's tokens out of the stylesheet, resolve the
 * toolbar rules that reach the buttons `setupToolbar` rendered, paint them over
 * each other in order, and assert the WCAG contrast of the label against what
 * is under it.
 *
 * **Which rules count, and how they are ordered.** Only rules whose selector
 * names `.floating-toolbar`, and for one property the last of them in the
 * stylesheet wins. That is not the cascade; it agrees with it in this block,
 * where of the rules that reach one element each later one is at least as
 * specific as those before it, and a rule elsewhere that reached a toolbar
 * button would not be seen here.
 *
 * **Not covered, stated rather than implied.** Whether the bar reads as a
 * surface floating over the page is a look, and the shadow that carries it is
 * not a colour this reader resolves; the owner checks it by hand, in every
 * palette, on the pull request artifact.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
import stylesCss from '../styles.css?raw';
import { reaches, type StyleRule, stylesheetRules } from '../test-support/stylesheet-rules';
import {
  contrast,
  over,
  paletteTokens,
  type Rgba,
  resolveColour,
} from '../test-support/theme-colours';
import { setupToolbar } from './toolbar';

/** WCAG AA for text of this size: 13 px at weight 600 is not large text. */
const AA = 4.5;

const rules = stylesheetRules(stylesCss);
const palettes = paletteTokens(rules);
const toolbarRules = rules.filter(
  (rule) => rule.conditions.length === 0 && rule.selector.includes('.floating-toolbar'),
);

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

/** The toolbar `setupToolbar` renders, with one button active and one not. */
function renderedToolbar(): { bar: HTMLElement; plain: HTMLElement; active: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown('**bold** plain');
  setupToolbar(instance.editor, { onLink: vi.fn(), onImageDescription: vi.fn() });
  instance.editor.commands.setTextSelection({ from: 2, to: 4 });
  const bar = document.getElementById('floating-toolbar');
  if (!bar) throw new Error('setupToolbar rendered no toolbar');
  const byTitle = (title: string) => {
    const button = Array.from(bar.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.title === title,
    );
    if (!button) throw new Error(`no toolbar button titled ${title}`);
    return button;
  };
  const active = byTitle('Bold (Ctrl+B)');
  const plain = byTitle('Italic (Ctrl+I)');
  if (!active.classList.contains('active') || plain.classList.contains('active')) {
    throw new Error('the selection did not light Bold alone');
  }
  return { bar, plain, active };
}

/**
 * The value the last matching toolbar rule gives a property, reading the
 * `background` shorthand as the colour and the image it sets. `hovered` takes
 * `:hover` out of each selector, since happy-dom has no pointer.
 */
function declared(
  target: Element,
  property: 'color' | 'background-color' | 'background-image',
  hovered: boolean,
): string | null {
  let value: string | null = null;
  const matching = (rule: StyleRule) => {
    const selector = hovered ? rule.selector.replaceAll(':hover', '') : rule.selector;
    return (hovered || !rule.selector.includes(':hover')) && reaches(selector, target);
  };
  for (const rule of toolbarRules.filter(matching)) {
    const shorthand = rule.declarations.get('background');
    if (shorthand !== undefined && property !== 'color') {
      // The shorthand sets both halves, and resets whichever it does not name.
      const isImage = /gradient\(|url\(/.test(shorthand);
      if (property === 'background-color') value = isImage ? 'transparent' : shorthand;
      else value = isImage ? shorthand : 'none';
    }
    value = rule.declarations.get(property) ?? value;
  }
  return value;
}

interface Painted {
  readonly bar: Rgba;
  readonly under: Rgba;
  readonly label: Rgba;
}

/** What is under a button's label, and the label, in one palette. */
function paint(
  tokens: ReadonlyMap<string, string>,
  bar: Element,
  button: Element,
  hovered: boolean,
): Painted {
  const page = resolveColour('var(--bg)', tokens);
  const barColour = over(
    resolveColour(declared(bar, 'background-color', false) ?? 'none', tokens),
    page,
  );
  let under = over(
    resolveColour(declared(button, 'background-color', hovered) ?? 'none', tokens),
    barColour,
  );
  under = over(
    resolveColour(declared(button, 'background-image', hovered) ?? 'none', tokens),
    under,
  );
  const colour = declared(button, 'color', hovered);
  if (colour === null) throw new Error('no toolbar rule gives the button a colour');
  return { bar: barColour, under, label: over(resolveColour(colour, tokens), under) };
}

const paletteNames = [...palettes.keys()];

describe('every label on the floating toolbar is readable in every palette (#319)', () => {
  it('reads the six palettes and a toolbar rule for each thing it paints', () => {
    // Seven until #398 took the GitHub pair out and put OLED Black in.
    expect(paletteNames).toHaveLength(6);
    const { bar, plain } = renderedToolbar();
    expect(declared(bar, 'background-color', false)).not.toBeNull();
    expect(declared(plain, 'color', false)).not.toBeNull();
  });

  it.each(paletteNames)('%s: a button at rest', (name) => {
    const { bar, plain } = renderedToolbar();
    const { label, under } = paint(palettes.get(name)!, bar, plain, false);
    expect(contrast(label, under)).toBeGreaterThanOrEqual(AA);
  });

  it.each(paletteNames)('%s: a button under the pointer, which changes', (name) => {
    const { bar, plain } = renderedToolbar();
    const tokens = palettes.get(name)!;
    const rest = paint(tokens, bar, plain, false);
    const hovered = paint(tokens, bar, plain, true);
    expect(contrast(hovered.label, hovered.under)).toBeGreaterThanOrEqual(AA);
    expect(contrast(hovered.under, rest.under)).toBeGreaterThan(1);
  });

  it.each(
    paletteNames,
  )('%s: the active button, at rest and under the pointer, apart from the bar', (name) => {
    const { bar, active } = renderedToolbar();
    const tokens = palettes.get(name)!;
    const rest = paint(tokens, bar, active, false);
    const hovered = paint(tokens, bar, active, true);
    expect(contrast(rest.label, rest.under)).toBeGreaterThanOrEqual(AA);
    expect(contrast(hovered.label, hovered.under)).toBeGreaterThanOrEqual(AA);
    expect(contrast(rest.under, rest.bar)).toBeGreaterThan(1);
  });
});
