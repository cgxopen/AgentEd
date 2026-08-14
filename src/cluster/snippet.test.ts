import { describe, expect, it } from 'vitest';
import { extractSnippet } from './snippet';

describe('extractSnippet — happy paths', () => {
  it('returns the first non-empty line of plain content', () => {
    const out = extractSnippet('This is the project context for the backend service.');
    expect(out).toBe('This is the project context for the backend service.');
  });

  it('skips leading blank lines', () => {
    const content = '\n\n\nReal content starts here.\n';
    expect(extractSnippet(content)).toBe('Real content starts here.');
  });

  it('skips heading lines and returns the first body line', () => {
    const content = '# Title\n\n## Section\n\nBody starts on this line.\n';
    expect(extractSnippet(content)).toBe('Body starts on this line.');
  });

  it('truncates with an ellipsis when beyond maxChars', () => {
    const long = 'a'.repeat(200);
    const out = extractSnippet(long, 80);
    expect(out.length).toBeLessThanOrEqual(81);
    expect(out.endsWith('…')).toBe(true);
  });

  it('honours custom maxChars', () => {
    const out = extractSnippet('hello world', 5);
    expect(out).toBe('hello…');
  });
});

describe('extractSnippet — frontmatter handling', () => {
  it('strips a YAML frontmatter block before scanning', () => {
    const content = `---\nname: my-skill\ndescription: stuff\n---\n\nReal body line.`;
    expect(extractSnippet(content)).toBe('Real body line.');
  });

  it('handles CRLF line endings in the frontmatter', () => {
    const content = `---\r\nname: my-skill\r\n---\r\n\r\nFirst body line.\r\n`;
    expect(extractSnippet(content)).toBe('First body line.');
  });

  it('leaves content alone when frontmatter is malformed (no closing fence)', () => {
    const content = `---\nname: stuck\nno close here\nstill content`;
    // No close → treat as body, first non-heading line is `---`. The
    // `---` line itself isn't a heading marker so it gets returned.
    const snippet = extractSnippet(content);
    expect(snippet).toBe('---');
  });

  it('strips a leading BOM before checking for the fence', () => {
    const content = `﻿---\nname: x\n---\n\nBOM-prefixed body.`;
    expect(extractSnippet(content)).toBe('BOM-prefixed body.');
  });
});

describe('extractSnippet — fallbacks', () => {
  it('returns the first heading text when there is no body', () => {
    const content = '# Top heading\n\n## Subheading only\n';
    expect(extractSnippet(content)).toBe('Top heading');
  });

  it('returns "(empty)" when content is blank', () => {
    expect(extractSnippet('')).toBe('(empty)');
    expect(extractSnippet('   \n\n   \n')).toBe('(empty)');
  });

  it('returns "(empty)" when only frontmatter is present', () => {
    const content = `---\nname: x\n---\n`;
    expect(extractSnippet(content)).toBe('(empty)');
  });
});
