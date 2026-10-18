import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';

/**
 * #605: no backslash inside or beside a bare URL GitHub reads as a link.
 *
 * What GitHub reads is not observable here, since cmark-gfm is no dependency
 * of this repository: the pull request reads each row below with cmark-gfm
 * before and after the save. These rows pin the bytes, which is the half the
 * harness can see: on `main` every one of them gained the backslash GitHub
 * took into the address, `%5C`.
 */

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance?.destroy();
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

function save(markdown: string): string {
  return `${editorWith(markdown).getMarkdown().trim()}\n`;
}

/** Open, save, and save what came back. */
function writes(markdown: string, expected: string = markdown): void {
  const once = save(markdown);
  expect(once, 'the first save').toBe(expected);
  expect(save(once), 'the second save').toBe(once);
}

describe('a bare URL is written without a backslash GitHub would read into it', () => {
  it.each([
    ['an underscore after a hash', 'See https://example.com/faq#_how for more.\n'],
    ['brackets in a path', 'Path https://example.com/a/[x]/b here.\n'],
    ['an underscore the URL ends before', 'Ends https://example.com/a_b_ here.\n'],
    ['brackets right before and after a URL', '- Add file (#3)[https://github.com/o/r/issues/3]\n'],
    ['an email address', 'Write to first_last_@example.com today.\n'],
    ['the www form', 'See www.example.com/a_b_ and www.example.com/[x] here.\n'],
    ['a URL in a heading', '# Head https://example.com/#_x\n'],
    ['a URL in a quote', '> Quote https://example.com/#_y\n'],
    ['a URL in a list item', '- Item https://example.com/#_z\n'],
    ['a URL in a table cell', '| a | b |\n| - | - |\n| https://example.com/#_z | c |\n'],
  ])('%s', (_name, markdown) => {
    writes(markdown);
  });

  it('keeps the escape of a bracket that opens a reference, and none beside the URL', () => {
    writes(
      '- [GitHub repo][https://github.com/o/r]\n',
      '- \\[GitHub repo\\][https://github.com/o/r]\n',
    );
    writes(
      'Fix (By [Craig Andrews]https://github.com/candrews)\n',
      'Fix (By \\[Craig Andrews]https://github.com/candrews)\n',
    );
  });
});

describe('the escape is kept where it is not beside a URL, or where the editor would read it otherwise', () => {
  it('escapes a bracket and a star with no URL, as before', () => {
    writes(
      'Control snake_case and _em_ and [x] alone.\n',
      'Control snake_case and _em_ and \\[x\\] alone.\n',
    );
  });

  it('writes the backslash where the bare character would pair with another for the editor', () => {
    // Both stars bare, the editor would read an emphasis from one URL to the
    // other, so the block reads otherwise: the first goes bare, which still
    // reads the same, and the second keeps its backslash. The file wrote both,
    // and the first is a redundant escape it no longer gets back, R-C2.
    expect(save('See https://x.com/\\*a and https://y.com/b\\* end.\n')).toBe(
      'See https://x.com/*a and https://y.com/b\\* end.\n',
    );
  });

  it('writes every backslash in a document that carries the stand-in, as before', () => {
    // U+E01D is the character this route stands in with; one the person wrote
    // is theirs, so nothing is held and nothing is swept (#425).
    expect(save('x https://example.com/#_y\n')).toBe('x https://example.com/#\\_y\n');
  });
});

describe('the typed half', () => {
  /** Text inserted at the end of an empty document, as a keystroke without its input rules. */
  function typedAsText(text: string): string {
    const editor = editorWith('');
    editor.editor.commands.focus('end');
    editor.editor.view.dispatch(editor.editor.state.tr.insertText(text));
    return editor.getMarkdown().trim();
  }

  it('writes a typed URL with an underscore without the backslash', () => {
    expect(typedAsText('see https://example.com/faq#_how for more')).toBe(
      'see https://example.com/faq#_how for more',
    );
  });

  it('writes a typed currency emphasis and a tilde before a span as main writes them', () => {
    expect(typedAsText('*£*bravo.')).toBe('\\*£\\*bravo.');
    expect(typedAsText('a ~`code` b')).toBe('a ~\\`code\\` b');
  });
});
