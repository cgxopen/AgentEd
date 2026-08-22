import { describe, expect, it } from 'vitest';
import { assembleMarkdown, splitFrontmatter } from './frontmatter';
import { DEFAULT_LINE_CONVENTIONS } from './line-conventions';
import type { DocumentBundle } from './types';

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
  function bundle(frontmatterRaw: string | null, markdownBody: string): DocumentBundle {
    return {
      frontmatterRaw,
      markdownBody,
      images: [],
      rootPath: 'test.md',
      lineConventions: DEFAULT_LINE_CONVENTIONS,
    };
  }

  it('reassembles frontmatter + body', () => {
    const md = assembleMarkdown(bundle('name: x', '# Body'));
    expect(md).toBe('---\nname: x\n---\n# Body');
  });

  it('returns body only when frontmatter is null', () => {
    const md = assembleMarkdown(bundle(null, '# Body only'));
    expect(md).toBe('# Body only');
  });

  it('roundtrips: split → assemble produces original', () => {
    const original = '---\nname: skill\n---\n# Title\n\ntext';
    const { raw, body } = splitFrontmatter(original);
    const reassembled = assembleMarkdown(bundle(raw, body));
    expect(reassembled).toBe(original);
  });
});
