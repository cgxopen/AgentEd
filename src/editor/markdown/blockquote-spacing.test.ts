/**
 * A blockquote keeps the blank-line spelling its file used (#199).
 *
 * Unlike the last three changes this one is bytes rather than paint, so
 * the tests can see the whole of it: every case below is driven from
 * markdown, through the ordinary open path, and asserted on the markdown
 * that would be saved. The manual pass confirms rather than verifies.
 *
 * ── Why an attribute and not a serializer repair ──
 *
 * The two spellings produce **byte-identical HTML** — measured, and
 * asserted below. So by the time the serializer is handed a document the
 * distinction is gone, and no rule in it can put the file back: it can
 * only pick one spelling and rewrite the other. Keeping both means asking
 * the file while it is being read and carrying the answer, which is what
 * `blockquote-spacing.ts` does and what #28 did for a list.
 */
import { describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';
import {
  BARE_BLANK_MARKER,
  BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE,
  firstBlankLineSpelling,
  hasMixedBlankLineSpelling,
} from './blockquote-spacing';
import { markdownToHtml } from './parse';

vi.mock('../../ui/toast', () => ({ showToast: vi.fn() }));

let instance: EditorInstance | null = null;

/** Open through the ordinary route and return what would be saved. */
function openAndSave(markdown: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  const saved = instance.getMarkdown();
  instance.destroy();
  instance = null;
  host.remove();
  return saved;
}

describe('the two spellings are the same document', () => {
  it('parse to byte-identical HTML apart from the attribute this adds', () => {
    // The measurement the whole shape of this change rests on. Without the
    // attribute these are indistinguishable, which is why a rule in the
    // serializer could only ever have swapped which spelling was wrong.
    const bare = markdownToHtml('> a\n>\n> b');
    const spaced = markdownToHtml('> a\n> \n> b');

    const strip = (html: string) =>
      html.replace(new RegExp(` ${BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE}="[^"]*"`, 'g'), '');
    expect(strip(bare)).toBe(strip(spaced));

    // And the attribute is the whole of the difference.
    expect(bare).toContain(`${BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE}="${BARE_BLANK_MARKER}"`);
    expect(spaced).not.toContain(BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE);
  });
});

describe('a quote written with a bare marker keeps it', () => {
  const CASES: Array<[string, string]> = [
    ['two blocks', '> a\n>\n> b'],
    ['three blocks, two blank lines', '> a\n>\n> b\n>\n> c'],
    ['a quote inside a quote', '> > a\n> >\n> > b'],
    ['three levels deep', '> > > a\n> > >\n> > > b'],
    ['a quote inside a list item', '- > a\n  >\n  > b'],
    ['a loose task list inside a quote', '> - [ ] a\n>\n> - [ ] b'],
    ['a fenced block with a blank line in it', '> ```\n> a\n>\n> b\n> ```'],
  ];

  for (const [name, markdown] of CASES) {
    it(`${name} saves byte for byte`, () => {
      expect(openAndSave(markdown)).toBe(markdown);
    });
  }
});

describe('a quote written with a space after the marker keeps that', () => {
  // The half that shows the repair has not become a normalisation in the
  // other direction. Before this, the space was what every quote got; a
  // change that merely flipped the canonical form would pass the block
  // above and fail every row here.
  const CASES: Array<[string, string]> = [
    ['two blocks', '> a\n> \n> b'],
    ['three blocks, two blank lines', '> a\n> \n> b\n> \n> c'],
    ['a quote inside a quote', '> > a\n> > \n> > b'],
    ['a quote inside a list item', '- > a\n  > \n  > b'],
    ['a fenced block with a blank line in it', '> ```\n> a\n> \n> b\n> ```'],
  ];

  for (const [name, markdown] of CASES) {
    it(`${name} saves byte for byte`, () => {
      expect(openAndSave(markdown)).toBe(markdown);
    });
  }
});

describe('the quote is still one quote', () => {
  it('holds both blocks after the round trip, not two quotes', () => {
    // Bytes matching is not enough on its own: taking the marker off the
    // blank line entirely would end the quote there and start another, and
    // a document with two quotes can still spell the same characters. So
    // this asks the document model.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host);
    editor.setMarkdown('> a\n>\n> b');

    const quotes: number[] = [];
    editor.editor.state.doc.descendants((node) => {
      if (node.type.name === 'blockquote') quotes.push(node.childCount);
      return true;
    });

    expect(quotes).toEqual([2]);
    editor.destroy();
    host.remove();
  });

  it('still holds one quote after a save and a reopen', () => {
    const saved = openAndSave('> a\n>\n> b');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host);
    editor.setMarkdown(saved);

    const quotes: number[] = [];
    editor.editor.state.doc.descendants((node) => {
      if (node.type.name === 'blockquote') quotes.push(node.childCount);
      return true;
    });

    expect(quotes).toEqual([2]);
    editor.destroy();
    host.remove();
  });
});

describe('a line whose trailing spaces are the user content', () => {
  // The direction this repair could have gone too far in. A fenced block
  // inside a quote can hold a line made of spaces, and a rule that trimmed
  // any trailing space from a line beginning with a marker would eat it.
  //
  // Measured on this build, which is what makes the narrowing safe rather
  // than lucky: a blank line is a marker and exactly one space, and a
  // content line of one space is a marker and **two**. The two cannot be
  // confused, so the pattern admits one space and no more.
  const CASES: Array<[string, string]> = [
    ['one space of content', '> ```\n> a\n>  \n> b\n> ```'],
    ['three spaces of content', '> ```\n> a\n>    \n> b\n> ```'],
    ['content spaces in a quote spelled bare elsewhere', '> ```\n> a\n>  \n> b\n> ```\n>\n> after'],
  ];

  for (const [name, markdown] of CASES) {
    it(`${name} is untouched`, () => {
      expect(openAndSave(markdown)).toBe(markdown);
    });
  }
});

describe('a quote that spells its blank lines both ways', () => {
  // The exception this change records in place of the one it removes. One
  // quote carries one answer, so a mixed quote is written the way it
  // opened. Recorded in REQUIREMENTS beside the mixed line endings, whose
  // shape and reason are the same.
  it('is written throughout the way it opened, bare first', () => {
    expect(openAndSave('> a\n>\n> b\n> \n> c')).toBe('> a\n>\n> b\n>\n> c');
  });

  it('is written throughout the way it opened, spaced first', () => {
    expect(openAndSave('> a\n> \n> b\n>\n> c')).toBe('> a\n> \n> b\n> \n> c');
  });

  it('is named by the module rather than left to be discovered', () => {
    expect(hasMixedBlankLineSpelling('> a\n>\n> b\n> \n> c')).toBe(true);
    expect(hasMixedBlankLineSpelling('> a\n>\n> b')).toBe(false);
    expect(hasMixedBlankLineSpelling('> a\n> \n> b')).toBe(false);
  });
});

describe('reading the spelling out of the raw source', () => {
  it('answers bare, spaced, or nothing at all', () => {
    expect(firstBlankLineSpelling('> a\n>\n> b')).toBe('bare');
    expect(firstBlankLineSpelling('> a\n> \n> b')).toBe('spaced');
    // A quote with no blank line has no spelling to keep.
    expect(firstBlankLineSpelling('> a')).toBe(null);
    // Two or more trailing spaces is a line with content in it, so it says
    // nothing about how this quote spells a blank line.
    expect(firstBlankLineSpelling('> ```\n> a\n>  \n> ```')).toBe(null);
  });

  it('reads the first blank line and not a later one', () => {
    expect(firstBlankLineSpelling('> a\n>\n> b\n> \n> c')).toBe('bare');
    expect(firstBlankLineSpelling('> a\n> \n> b\n>\n> c')).toBe('spaced');
  });

  it('reads a nested marker run as one marker run', () => {
    expect(firstBlankLineSpelling('> > a\n> >\n> > b')).toBe('bare');
    expect(firstBlankLineSpelling('> > a\n> > \n> > b')).toBe('spaced');
  });
});

describe('nothing about the spelling reaches the file', () => {
  it('writes no attribute into the markdown', () => {
    const saved = openAndSave('> a\n>\n> b');
    expect(saved).not.toContain(BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE);
    expect(saved).not.toContain('blockquote');
  });

  it('leaves a quote created in the editor written the way it always was', () => {
    // Nothing tells a new quote how its file spelled anything, because it
    // has no file. The default is the spelling turndown writes on its own,
    // so this cannot change what the editor produces from scratch.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host);
    editor.setMarkdown('');
    editor.editor.commands.insertContent('<blockquote><p>a</p><p>b</p></blockquote>');

    expect(editor.getMarkdown()).toBe('> a\n> \n> b');
    editor.destroy();
    host.remove();
  });
});
