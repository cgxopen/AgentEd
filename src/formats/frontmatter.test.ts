import { describe, expect, it } from 'vitest';
import { assembleMarkdown, splitFrontmatter } from './frontmatter';
import { DEFAULT_LINE_CONVENTIONS } from './line-conventions';
import type { MarkdownDocument } from './types';

describe('splitFrontmatter', () => {
  it('splits frontmatter and body correctly', () => {
    const input = '---\nname: skill\ndescription: test\n---\n# Body\n\ntext';
    const { raw, body } = splitFrontmatter(input);
    expect(raw).toBe('name: skill\ndescription: test');
    expect(body).toBe('# Body\n\ntext');
  });

  it('returns null frontmatter for body without delimiter', () => {
    const input = '# Just a body\n\nNo frontmatter here.';
    const { raw, body } = splitFrontmatter(input);
    expect(raw).toBeNull();
    expect(body).toBe(input);
  });

  it('handles CRLF line endings', () => {
    const input = '---\r\nname: skill\r\n---\r\n# Body';
    const { raw, body } = splitFrontmatter(input);
    expect(raw).toBe('name: skill');
    expect(body).toBe('# Body');
  });

  it('handles empty body after frontmatter', () => {
    const input = '---\nname: x\n---\n';
    const { raw, body } = splitFrontmatter(input);
    expect(raw).toBe('name: x');
    expect(body).toBe('');
  });
});

describe('assembleMarkdown', () => {
  function makeDocument(frontmatterRaw: string | null, markdownBody: string): MarkdownDocument {
    return {
      frontmatterRaw,
      markdownBody,
      images: [],
      rootPath: 'test.md',
      byteOrderMark: false,
      lineConventions: DEFAULT_LINE_CONVENTIONS,
    };
  }

  it('reassembles frontmatter + body', () => {
    const md = assembleMarkdown(makeDocument('name: x', '# Body'));
    expect(md).toBe('---\nname: x\n---\n# Body');
  });

  it('returns body only when frontmatter is null', () => {
    const md = assembleMarkdown(makeDocument(null, '# Body only'));
    expect(md).toBe('# Body only');
  });

  it('roundtrips: split → assemble produces original', () => {
    const original = '---\nname: skill\n---\n# Title\n\ntext';
    const { raw, body } = splitFrontmatter(original);
    const reassembled = assembleMarkdown(makeDocument(raw, body));
    expect(reassembled).toBe(original);
  });

  it('writes an empty block, which is a block and not the absence of one (#304)', () => {
    expect(assembleMarkdown(makeDocument('', '# Body'))).toBe('---\n\n---\n# Body');
    expect(assembleMarkdown(makeDocument('', ''))).toBe('---\n\n---\n');
  });

  it('respells the first rule of a body that would otherwise be read as a block (#304)', () => {
    const body = '---\n\nWords\n\n---\n\nAfter';
    const written = assembleMarkdown(makeDocument(null, body));
    expect(written).toBe('***\n\nWords\n\n---\n\nAfter');
    expect(splitFrontmatter(written).raw).toBeNull();
  });

  it('leaves a body alone when a block is written above it (#304)', () => {
    const body = '---\n\nWords\n\n---\n\nAfter';
    expect(assembleMarkdown(makeDocument('title: x', body))).toBe(`---\ntitle: x\n---\n${body}`);
  });
});
