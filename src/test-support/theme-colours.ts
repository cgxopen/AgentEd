/**
 * Colours as the stylesheet resolves them in each palette, for tests that ask
 * what a rule **computes to** rather than whether it is there (#319).
 *
 * A rule such as `background: var(--text)` is valid in every palette, and a
 * test that asserted it exists would have passed while the floating toolbar was
 * unreadable in three of them. What was wrong was the value it resolved to, so
 * these helpers resolve it: the custom properties of the bare `:root` block,
 * overlaid by one `:root[data-theme="…"]` block, then `var()`, `color-mix()` and
 * the single-colour `linear-gradient` the stylesheet uses for stacked shades.
 *
 * **What it cannot do, stated.** It reads colours and nothing about how they
 * are laid out: a shadow, a blur, anti-aliasing and the text rendering of a
 * label are not in any figure here. A value in a form this does not parse
 * throws, so a rule rewritten in a new form fails loudly rather than passing.
 */
import type { StyleRule } from './stylesheet-rules';

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0 to 1. */
  readonly a: number;
}

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** The palette the bare `:root` block describes, which carries no `data-theme`. */
export const DEFAULT_PALETTE = 'light';

const THEME_SELECTOR = /^:root(?:\[data-theme="([a-z0-9-]+)"\])?$/;

/**
 * Every palette the stylesheet defines, each as its full set of custom
 * properties: the bare `:root` block, with the palette's own block over it.
 * Only unconditional blocks count, so a `:root` inside `@media` is not a palette.
 */
export function paletteTokens(rules: readonly StyleRule[]): Map<string, Map<string, string>> {
  const base = new Map<string, string>();
  const own = new Map<string, Map<string, string>>();
  for (const rule of rules) {
    if (rule.conditions.length > 0) continue;
    const match = THEME_SELECTOR.exec(rule.selector);
    if (!match) continue;
    const target = match[1] === undefined ? base : (own.get(match[1]) ?? new Map<string, string>());
    if (match[1] !== undefined) own.set(match[1], target);
    for (const [property, value] of rule.declarations) {
      if (property.startsWith('--')) target.set(property, value);
    }
  }
  const palettes = new Map<string, Map<string, string>>([[DEFAULT_PALETTE, base]]);
  for (const [name, tokens] of own) palettes.set(name, new Map([...base, ...tokens]));
  return palettes;
}

/** The arguments of a function call, split at the commas outside parentheses. */
function argumentsOf(value: string, name: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith(`${name}(`) || !trimmed.endsWith(')')) return null;
  const inner = trimmed.slice(name.length + 1, -1);
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && depth === 0) {
      parts.push(inner.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(inner.slice(from).trim());
  return parts;
}

function parseHex(value: string): Rgba | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex === undefined) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

function parseRgb(value: string): Rgba | null {
  const match = /^rgba?\(([^)]*)\)$/.exec(value);
  if (!match) return null;
  const numbers = match[1].split(/[\s,/]+/).filter((part) => part !== '');
  if (numbers.length < 3 || numbers.length > 4) return null;
  const [r, g, b] = numbers.slice(0, 3).map(Number);
  const a = numbers.length === 4 ? Number(numbers[3]) : 1;
  return [r, g, b, a].some(Number.isNaN) ? null : { r, g, b, a };
}

/** `color-mix(in srgb, A p%, B)`, premultiplied as CSS Color 5 mixes it. */
function mixSrgb(args: string[], tokens: ReadonlyMap<string, string>, depth: number): Rgba {
  const [space, first, second] = args;
  if (args.length !== 3 || space !== 'in srgb') {
    throw new Error(`color-mix other than two colours in srgb: ${args.join(', ')}`);
  }
  const split = (part: string): [string, number | null] => {
    const match = /^(.*\S)\s+(\d+(?:\.\d+)?)%$/.exec(part);
    return match ? [match[1], Number(match[2]) / 100] : [part, null];
  };
  const [colourA, pa] = split(first);
  const [colourB, pb] = split(second);
  const weightA = pa ?? (pb === null ? 0.5 : 1 - pb);
  const a = resolveColour(colourA, tokens, depth + 1);
  const b = resolveColour(colourB, tokens, depth + 1);
  const alpha = a.a * weightA + b.a * (1 - weightA);
  if (alpha === 0) return TRANSPARENT;
  const channel = (x: number, y: number) => (x * a.a * weightA + y * b.a * (1 - weightA)) / alpha;
  return { r: channel(a.r, b.r), g: channel(a.g, b.g), b: channel(a.b, b.b), a: alpha };
}

/** `var()` references resolve through at most this many steps before it throws. */
const MAX_DEPTH = 16;

/** The colour a value computes to in the palette whose tokens are given. */
export function resolveColour(value: string, tokens: ReadonlyMap<string, string>, depth = 0): Rgba {
  if (depth > MAX_DEPTH) throw new Error(`more than ${MAX_DEPTH} steps resolving ${value}`);
  const trimmed = value.trim();
  if (trimmed === 'none' || trimmed === 'transparent') return TRANSPARENT;
  if (trimmed === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  const variable = argumentsOf(trimmed, 'var');
  if (variable) {
    const token = tokens.get(variable[0]);
    if (token === undefined) throw new Error(`no ${variable[0]} in this palette`);
    return resolveColour(token, tokens, depth + 1);
  }
  const gradient = argumentsOf(trimmed, 'linear-gradient');
  if (gradient) {
    const stops = gradient.map((stop) => resolveColour(stop, tokens, depth + 1));
    const same = stops.every((stop) => JSON.stringify(stop) === JSON.stringify(stops[0]));
    if (!same) throw new Error(`a gradient of more than one colour: ${trimmed}`);
    return stops[0];
  }
  const mix = argumentsOf(trimmed, 'color-mix');
  if (mix) return mixSrgb(mix, tokens, depth);
  const parsed = parseHex(trimmed) ?? parseRgb(trimmed);
  if (!parsed) throw new Error(`a colour this reader does not parse: ${trimmed}`);
  return parsed;
}

/** `top` painted over `ground`, which is taken as opaque. */
export function over(top: Rgba, ground: Rgba): Rgba {
  const mixChannel = (x: number, y: number) => x * top.a + y * (1 - top.a);
  return {
    r: mixChannel(top.r, ground.r),
    g: mixChannel(top.g, ground.g),
    b: mixChannel(top.b, ground.b),
    a: 1,
  };
}

function luminance(colour: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(colour.r) + 0.7152 * linear(colour.g) + 0.0722 * linear(colour.b);
}

/** The WCAG 2 contrast ratio of two opaque colours, from 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
