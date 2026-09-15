import { describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { stylesheetRules } from './stylesheet-rules';

const shippedRules = stylesheetRules(stylesCss);

describe('the stylesheet reader these tests stand on', () => {
  it('gives every rule inside a @media block its condition, not only the first', () => {
    const rules = stylesheetRules(
      'a { color: red; }\n@media (max-width: 600px) {\n  b { color: blue; }\n  c { max-height: 1px; }\n}\nd { color: green; }',
    );

    expect(rules.map((rule) => [rule.selector, rule.conditions])).toEqual([
      ['a', []],
      ['b', ['@media (max-width: 600px)']],
      ['c', ['@media (max-width: 600px)']],
      ['d', []],
    ]);
    expect(rules[2].declarations.get('max-height')).toBe('1px');
  });

  it('keeps a value that holds a semicolon or a colon whole', () => {
    const [rule] = stylesheetRules(
      'e { background: url("data:image/svg+xml;utf8,<svg/>") no-repeat; content: "a;b}"; color: red; }',
    );

    expect(rule.declarations.get('background')).toBe(
      'url("data:image/svg+xml;utf8,<svg/>") no-repeat',
    );
    expect(rule.declarations.get('content')).toBe('"a;b}"');
    expect(rule.declarations.get('color')).toBe('red');
  });

  it('reads the shipped stylesheet into clean selectors and property names', () => {
    expect(shippedRules.length).toBeGreaterThan(0);
    expect(shippedRules.filter((rule) => rule.conditions.length > 0).length).toBeGreaterThan(0);
    for (const rule of shippedRules) {
      expect(rule.selector).not.toMatch(/[{};]|^@/);
      for (const property of rule.declarations.keys())
        expect(property).toMatch(/^-{0,2}[a-z][a-z0-9-]*$/);
    }
  });
});
