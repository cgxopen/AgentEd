/**
 * Issue #138 — the preview shows the first line that carries text, and
 * when that line is a heading it shows the heading's text.
 *
 * **This file is rewritten rather than extended.** It used to pin the
 * opposite rule — skip headings, take the first body line, and go back
 * for the first heading only when the file was nothing but headings —
 * and a file holding cases for both rules would say the product does two
 * contradictory things with no way to tell which is current.
 *
 * The mutations these are here to catch: restore the skip and the
 * heading cases go red; leave the `#` characters on the returned text
 * and the stripping case goes red.
 *
 * The shapes below are the ones a heading actually takes, decided with a
 * measurement in front of them rather than from memory: across 56 context
 * files on the author's machine and every markdown file in this
 * repository, 54 open with an ATX heading (6 of those carrying inline
 * marks), 2 open with prose, and none open with a closing hash run, a
 * setext underline, a hash with no space, seven hashes, an empty heading
 * or four spaces of indent. The exotic ones are pinned anyway — they cost
 * one line each and they are what the rule has to *not* mis-read.
 */
import { describe, expect, it } from 'vitest';
import { extractSnippet } from './snippet';

describe('extractSnippet — the first line that carries text', () => {
  it('shows the heading text when the file opens with a heading', () => {
    // The case the issue was filed on. Before #138 this returned
    // "This is the context file the indicator must find."
    const content = '# Project rules\n\nThis is the context file the indicator must find.\n';
    expect(extractSnippet(content)).toBe('Project rules');
  });

  it('shows the prose when the file opens with prose — unchanged', () => {
    const out = extractSnippet('This is the project context for the backend service.');
    expect(out).toBe('This is the project context for the backend service.');
  });

  it('shows the first heading of a file that is nothing but headings', () => {
    // The same answer as before #138, reached by the general rule rather
    // than by the special case that used to rescue it. That case is gone,
    // not unreachable.
    const content = '# Top heading\n\n## Subheading only\n';
    expect(extractSnippet(content)).toBe('Top heading');
  });

  it('skips leading blank lines', () => {
    expect(extractSnippet('\n\n\nReal content starts here.\n')).toBe('Real content starts here.');
  });

  it('takes the heading it meets first, not the largest one', () => {
    const content = '## Section\n\n# Title\n\nBody.\n';
    expect(extractSnippet(content)).toBe('Section');
  });

  it('reads a heading at every level', () => {
    for (const hashes of ['#', '##', '###', '####', '#####', '######']) {
      expect(extractSnippet(`${hashes} Level ${hashes.length}\n\nBody.\n`)).toBe(
        `Level ${hashes.length}`,
      );
    }
  });
});

describe('extractSnippet — what counts as a heading', () => {
  it('drops a closing run of hashes', () => {
    expect(extractSnippet('## Title ##\n')).toBe('Title');
  });

  it('keeps hashes that close nothing, because no space precedes them', () => {
    // CommonMark closes a heading only on a run preceded by whitespace.
    expect(extractSnippet('## Title##\n')).toBe('Title##');
  });

  it('reads a hash with no space after it as text, not as a heading', () => {
    // `#hashtag` is a paragraph in CommonMark, so the hash is content and
    // stays on screen.
    expect(extractSnippet('#hashtag is not a heading\n')).toBe('#hashtag is not a heading');
  });

  it('reads seven hashes as text — past the six heading levels', () => {
    expect(extractSnippet('####### Seven\n')).toBe('####### Seven');
  });

  it('opens a heading under three spaces of indent and not under four', () => {
    expect(extractSnippet('   # Indented three\n')).toBe('Indented three');
    // Four spaces is an indented code block whose content starts with a
    // hash — so the hash is content and is shown.
    expect(extractSnippet('    # Indented four\n')).toBe('# Indented four');
  });

  it('leaves inline formatting inside a heading exactly as written', () => {
    // 6 of the 56 measured files open with a heading carrying marks. A
    // preview shows what the file says, and body lines have always shown
    // their own marks — stripping them here would make the two disagree,
    // and stripping them correctly is a markdown parser.
    expect(extractSnippet('# Scope `**` and **bold**\n')).toBe('Scope `**` and **bold**');
  });

  it('shows a setext heading, which needs no clause of its own', () => {
    // The text is already on the first line; the general rule returns it.
    expect(extractSnippet('Setext title\n============\n\nBody.\n')).toBe('Setext title');
  });

  it('passes over a heading that carries no text', () => {
    // `#` alone and `## ##` are empty headings in CommonMark. They carry
    // no text, which is the same reason a blank line is passed over.
    expect(extractSnippet('#\n\nBody after an empty heading.\n')).toBe(
      'Body after an empty heading.',
    );
    expect(extractSnippet('## ##\n\nBody after an empty heading.\n')).toBe(
      'Body after an empty heading.',
    );
  });
});

describe('extractSnippet — frontmatter handling', () => {
  it('strips a YAML frontmatter block before scanning', () => {
    const content = `---\nname: my-skill\ndescription: stuff\n---\n\n# Real heading.`;
    expect(extractSnippet(content)).toBe('Real heading.');
  });

  it('handles CRLF line endings, in the frontmatter and after it', () => {
    const content = `---\r\nname: my-skill\r\n---\r\n\r\n# First heading\r\n`;
    expect(extractSnippet(content)).toBe('First heading');
  });

  it('leaves content alone when frontmatter is malformed (no closing fence)', () => {
    // No close → the whole file is body, and `---` is the first line
    // carrying text.
    const content = `---\nname: stuck\nno close here\nstill content`;
    expect(extractSnippet(content)).toBe('---');
  });

  it('strips a leading BOM before checking for the fence', () => {
    const content = `﻿---\nname: x\n---\n\n# BOM-prefixed heading.`;
    expect(extractSnippet(content)).toBe('BOM-prefixed heading.');
  });
});

describe('extractSnippet — length and emptiness', () => {
  it('truncates with an ellipsis when beyond maxChars', () => {
    const out = extractSnippet('a'.repeat(200), 80);
    expect(out.length).toBeLessThanOrEqual(81);
    expect(out.endsWith('…')).toBe(true);
  });

  it('truncates a heading by its text, not by its marks', () => {
    const out = extractSnippet(`# ${'a'.repeat(200)}`, 10);
    expect(out).toBe(`${'a'.repeat(10)}…`);
  });

  it('honours custom maxChars', () => {
    expect(extractSnippet('hello world', 5)).toBe('hello…');
  });

  it('says "(empty)" when nothing carries text', () => {
    expect(extractSnippet('')).toBe('(empty)');
    expect(extractSnippet('   \n\n   \n')).toBe('(empty)');
  });

  it('says "(empty)" when only frontmatter is present', () => {
    expect(extractSnippet(`---\nname: x\n---\n`)).toBe('(empty)');
  });

  it('says "(empty)" for a file of nothing but empty headings', () => {
    // Reachable only now: under the old rule the fallback would have
    // returned one of these.
    expect(extractSnippet('#\n\n##\n\n### ###\n')).toBe('(empty)');
  });
});
