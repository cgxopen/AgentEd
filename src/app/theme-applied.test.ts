/**
 * Issue #645 - nothing of the page is drawn before its theme.
 *
 * On a Mac a frame of the page painted before `ThemeManager` ran was seen for
 * about 0.2 s after the window was shown, at some launches. So the stylesheet
 * keeps the page transparent and its body hidden until `ThemeManager` marks
 * `<html>` as themed.
 *
 * What is on screen is not observable here: happy-dom paints nothing. The two
 * halves that are observable are joined instead. The rules are read out of the
 * shipped stylesheet, and their selectors are run against the page before and
 * after the manager is built. The owner pass on a Mac is where the absence of
 * the flash is verified.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { stylesheetRules } from '../test-support/stylesheet-rules';
import { THEME_APPLIED_ATTRIBUTE, ThemeManager } from './theme-manager';

const rules = stylesheetRules(stylesCss);
const GATE = `html:not([${THEME_APPLIED_ATTRIBUTE}])`;

function rulesFor(selector: string) {
  return rules.filter((rule) =>
    rule.selector
      .split(',')
      .map((part) => part.trim())
      .includes(selector),
  );
}

beforeEach(() => {
  localStorage.clear();
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.removeAttribute(THEME_APPLIED_ATTRIBUTE);
});

describe('the page draws nothing before its theme (#645)', () => {
  it('the stylesheet keeps the unthemed page transparent and its body hidden', () => {
    expect(rulesFor(GATE).map((r) => r.declarations.get('background'))).toContain('transparent');
    const body = rulesFor(`${GATE} body`);
    expect(body.map((r) => r.declarations.get('background'))).toContain('transparent');
    expect(body.map((r) => r.declarations.get('visibility'))).toContain('hidden');
    for (const rule of [...rulesFor(GATE), ...body]) expect(rule.conditions).toEqual([]);
  });

  it('the gate holds the page before the manager runs and lets it go after', () => {
    const root = document.documentElement;
    expect(root.matches(GATE)).toBe(true);
    expect(document.body.matches(`${GATE} body`)).toBe(true);

    new ThemeManager();

    expect(root.matches(GATE)).toBe(false);
    expect(document.body.matches(`${GATE} body`)).toBe(false);
  });

  it('every palette, Default Light included, sets the mark', () => {
    for (const palette of ['default', 'paper', 'solarized', 'oled']) {
      for (const mode of ['light', 'dark', 'auto']) {
        localStorage.setItem('agented:palette', palette);
        localStorage.setItem('agented:theme', mode);
        document.documentElement.removeAttribute(THEME_APPLIED_ATTRIBUTE);
        new ThemeManager();
        expect(
          document.documentElement.hasAttribute(THEME_APPLIED_ATTRIBUTE),
          `${palette} ${mode}`,
        ).toBe(true);
      }
    }
  });
});
