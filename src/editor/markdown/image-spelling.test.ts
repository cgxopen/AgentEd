/**
 * The spelling carrier for images (#27).
 *
 * The property everything else rests on is **identity**: setting a size to the
 * bytes a tag already holds returns those bytes, so an image nobody resized is
 * written back exactly as the file spelled it. It is asserted here over the
 * eleven spellings the decision on #27 was measured against — the three a
 * canonical rewrite happens to reproduce and the eight it does not.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeHtmlSource,
  encodeHtmlSource,
  IMAGE_HTML_SOURCE_ATTRIBUTE,
  imageMarkup,
  imageTagSpans,
  pixelValue,
  readTagAttribute,
  setTagAttribute,
  stampImageSources,
} from './image-spelling';

/**
 * The eleven spellings of one image, measured on `c6b0b40` against a canonical
 * `<img src alt width height>` rewrite. Three matched it and eight did not,
 * which is the measurement that chose the carrier — so they are the fixture the
 * carrier is held to rather than a list invented here.
 */
const SPELLINGS: readonly string[] = [
  '<img src="a.png" alt="x" width="600">',
  '<img src=a.png alt=x width=600>',
  "<img src='a.png' alt='x' width='600'>",
  '<img src="a.png" alt="x" width="600" />',
  '<img width="600" src="a.png" alt="x">',
  '<img src="a.png" alt="x" width="600" style="border:1px solid red">',
  '<IMG SRC="a.png" ALT="x" WIDTH="600">',
  '<img src="a.png" alt="x">',
  '<img src="a.png">',
  '<img src="a.png" alt="x" title="t" width="600">',
  '<img src="a.png" alt="x" width="600" height="300">',
];

describe('the size is written into the bytes the file used', () => {
  it.each(SPELLINGS)('writing back the width it already has changes nothing: %s', (tag) => {
    const width = readTagAttribute(tag, 'width');
    expect(setTagAttribute(tag, 'width', width)).toBe(tag);
  });

  it.each(SPELLINGS)('writing back the height it already has changes nothing: %s', (tag) => {
    const height = readTagAttribute(tag, 'height');
    expect(setTagAttribute(tag, 'height', height)).toBe(tag);
  });

  it.each(SPELLINGS)('an untouched image writes its own bytes: %s', (tag) => {
    const size = {
      width: pixelValue(readTagAttribute(tag, 'width')),
      height: pixelValue(readTagAttribute(tag, 'height')),
    };
    // The title is read out of the tag it is already in, so an HTML-spelled
    // image with one is written from its own bytes and this argument changes
    // nothing — which is step zero item 2 on #230, asserted rather than assumed.
    const title = readTagAttribute(tag, 'title');
    expect(imageMarkup(tag, 'x', 'a.png', title, size)).toBe(tag);
  });

  it('a changed width keeps the quoting the file used', () => {
    expect(setTagAttribute('<img src=a.png width=600>', 'width', '300')).toBe(
      '<img src=a.png width=300>',
    );
    expect(setTagAttribute("<img src='a.png' width='600'>", 'width', '300')).toBe(
      "<img src='a.png' width='300'>",
    );
  });

  it('a changed width keeps every other attribute, whatever it is', () => {
    expect(
      setTagAttribute(
        '<img src="a.png" alt="x" width="600" style="border:1px solid red" title="t">',
        'width',
        '300',
      ),
    ).toBe('<img src="a.png" alt="x" width="300" style="border:1px solid red" title="t">');
  });

  it('a width the tag does not carry is inserted before the closing bracket', () => {
    expect(setTagAttribute('<img src="a.png" alt="x">', 'width', '300')).toBe(
      '<img src="a.png" alt="x" width="300">',
    );
  });

  it('a self-closing tag keeps its slash last', () => {
    expect(setTagAttribute('<img src="a.png" alt="x" />', 'width', '300')).toBe(
      '<img src="a.png" alt="x" width="300" />',
    );
  });

  it('removing a width takes the whitespace in front of it too', () => {
    expect(setTagAttribute('<img src="a.png" alt="x" width="600">', 'width', null)).toBe(
      '<img src="a.png" alt="x">',
    );
  });

  it('removing a width the tag does not carry changes nothing', () => {
    expect(setTagAttribute('<img src="a.png">', 'width', null)).toBe('<img src="a.png">');
  });

  it('an upper-case attribute is the same attribute', () => {
    expect(readTagAttribute('<IMG SRC="a.png" WIDTH="600">', 'width')).toBe('600');
    expect(setTagAttribute('<IMG SRC="a.png" WIDTH="600">', 'width', '300')).toBe(
      '<IMG SRC="a.png" WIDTH="300">',
    );
  });

  it('a bare attribute is rewritten whole, because it has nowhere to put a value', () => {
    expect(setTagAttribute('<img src="a.png" width>', 'width', '300')).toBe(
      '<img src="a.png" width="300">',
    );
  });
});

describe('what the serializer is told to write', () => {
  it('a markdown image with no size stays markdown', () => {
    expect(imageMarkup(null, 'alt text', 'assets/a.png', null, { width: null, height: null })).toBe(
      '![alt text](assets/a.png)',
    );
  });

  it('a markdown image that has been resized becomes the canonical html form', () => {
    expect(imageMarkup(null, 'x', 'a.png', null, { width: 300, height: null })).toBe(
      '<img src="a.png" alt="x" width="300">',
    );
  });

  it('a height is written only when it is there', () => {
    expect(imageMarkup(null, 'x', 'a.png', null, { width: 300, height: 150 })).toBe(
      '<img src="a.png" alt="x" width="300" height="150">',
    );
  });

  it('an html image that has been resized keeps its own spelling', () => {
    expect(
      imageMarkup('<img src=a.png alt=x width=600 style="b">', 'x', 'a.png', null, {
        width: 300,
        height: null,
      }),
    ).toBe('<img src=a.png alt=x width=300 style="b">');
  });

  it('a reset takes the size attributes off and leaves the rest (decision 4 on #27)', () => {
    expect(
      imageMarkup(
        '<img src="a.png" alt="x" width="400" height="200" title="t">',
        'x',
        'a.png',
        null,
        {
          width: null,
          height: null,
        },
      ),
    ).toBe('<img src="a.png" alt="x" title="t">');
  });

  it('a markdown image reset to its natural size is markdown again (decision 4 on #27)', () => {
    expect(imageMarkup(null, 'x', 'a.png', null, { width: null, height: null })).toBe(
      '![x](a.png)',
    );
  });

  it('a markdown image writes the title the file gave it (#230)', () => {
    expect(imageMarkup(null, 'alt', 'img.png', 'the title', { width: null, height: null })).toBe(
      '![alt](img.png "the title")',
    );
  });

  it('an image with no title writes none, which is the regression half', () => {
    expect(imageMarkup(null, 'alt', 'img.png', null, { width: null, height: null })).toBe(
      '![alt](img.png)',
    );
  });

  it.each([
    ['a single quote', "it's here", '![a](i.png "it\'s here")'],
    ['parentheses', 'a (b) c', '![a](i.png "a (b) c")'],
    ['a closing parenthesis', 'a ) c', '![a](i.png "a ) c")'],
    ['a double quote', 'say " now', '![a](i.png "say \\" now")'],
    ['a backslash', 'back \\ slash', '![a](i.png "back \\\\ slash")'],
    ['both a backslash and a quote', '\\ and "', '![a](i.png "\\\\ and \\"")'],
  ])('a title holding %s is written the way CommonMark reads back', (_label, title, expected) => {
    // A writer that escaped too much would be as wrong as one that escaped too
    // little, so the rows that need *no* escape are here beside the two that do.
    expect(imageMarkup(null, 'a', 'i.png', title, { width: null, height: null })).toBe(expected);
  });

  it('a resized image carries its title into the canonical html form (#230)', () => {
    // The criterion #229 made necessary: the canonical form writes `alt`, so
    // without this a resize would be the moment a title left the file.
    expect(imageMarkup(null, 'x', 'a.png', 'the title', { width: 300, height: null })).toBe(
      '<img src="a.png" alt="x" title="the title" width="300">',
    );
  });

  it('a resized image with no title gains no title attribute', () => {
    expect(imageMarkup(null, 'x', 'a.png', null, { width: 300, height: null })).toBe(
      '<img src="a.png" alt="x" width="300">',
    );
  });

  it('an alt and a title each holding a double quote cannot break the tag', () => {
    // The reading recorded on the #229 merge: the canonical form is built by
    // concatenation, so an unescaped `"` in `alt` ends the attribute and
    // everything after it becomes markup. `title` arrives at the same line with
    // the identical hazard, so both are escaped by one rule rather than one of
    // them being repaired and the other left.
    const written = imageMarkup(null, 'say " hi', 'a.png', 'and " again', {
      width: 300,
      height: null,
    });
    expect(written).toBe(
      '<img src="a.png" alt="say &quot; hi" title="and &quot; again" width="300">',
    );

    // Asserted as a property too, not only as bytes: whatever the values hold,
    // the tag has exactly the attributes it should and each value survives.
    const box = document.createElement('div');
    box.innerHTML = written;
    const img = box.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('say " hi');
    expect(img?.getAttribute('title')).toBe('and " again');
    expect(img?.getAttribute('width')).toBe('300');
  });

  it('an ampersand and an angle bracket in either value are escaped too', () => {
    const written = imageMarkup(null, 'a & <b>', 'a.png', 'c & <d>', {
      width: 300,
      height: null,
    });
    expect(written).not.toContain('<b>');
    const box = document.createElement('div');
    box.innerHTML = written;
    const img = box.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('a & <b>');
    expect(img?.getAttribute('title')).toBe('c & <d>');
  });

  it.each([
    ['a percentage', '<img src="a.png" alt="x" width="50%">'],
    ['a keyword', '<img src="a.png" alt="x" width="auto">'],
    ['a unit this editor has no handle for', '<img src="a.png" alt="x" width="20em">'],
    ['a height in the same shape', '<img src="a.png" alt="x" height="50%">'],
  ])('a width written as %s is spelling, not a size, and survives untouched', (_label, tag) => {
    // `pixelValue` reads none of these as a size, so the node carries none —
    // and clearing on that basis would delete a number out of a file nobody
    // edited, which is the failure decision 1 on #27 rejected. The carrier of
    // width and height the brief first described would have dropped every one
    // of these; the bytes keep them.
    expect(imageMarkup(tag, 'x', 'a.png', null, { width: null, height: null })).toBe(tag);
  });

  it('a drag over a width this editor cannot express still writes pixels', () => {
    // Setting is unconditional, because a set means the user dragged. Only a
    // clear is conditional.
    expect(
      imageMarkup('<img src="a.png" alt="x" width="50%">', 'x', 'a.png', null, {
        width: 300,
        height: null,
      }),
    ).toBe('<img src="a.png" alt="x" width="300">');
  });
});

describe('the tag scan', () => {
  it('finds a tag whose alt text holds a closing bracket', () => {
    const raw = '<img src="a.png" alt="a > b">';
    expect(imageTagSpans(raw)).toEqual([[0, raw.length]]);
    expect(readTagAttribute(raw, 'alt')).toBe('a > b');
  });

  it('finds each of several tags in one token', () => {
    const raw = '<img src="a.png"> and <img src="b.png">';
    expect(imageTagSpans(raw)).toEqual([
      [0, 17],
      [22, 39],
    ]);
  });

  it('ignores an element that merely starts with the same letters', () => {
    expect(imageTagSpans('<image src="a.png">')).toEqual([]);
    expect(imageTagSpans('<imgx>')).toEqual([]);
  });

  it('ignores anything that is not an image', () => {
    expect(imageTagSpans('<p>text</p>')).toEqual([]);
    expect(imageTagSpans('plain text')).toEqual([]);
  });

  it('stops rather than looping on an unterminated tag', () => {
    expect(imageTagSpans('<img src="a.png"')).toEqual([]);
    expect(imageTagSpans('<img src="unclosed')).toEqual([]);
  });
});

describe('the bytes travel encoded, so they cannot carry markup', () => {
  it('round-trips a tag', () => {
    const tag = '<img src="a.png" alt="x" width="600">';
    expect(decodeHtmlSource(encodeHtmlSource(tag))).toBe(tag);
  });

  it.each([
    ['a quote that would end the attribute', '<img src="a.png" alt="&quot; onerror=alert(1)">'],
    ['a closing bracket', '<img src="a.png" alt="a > b">'],
    ['an ampersand', '<img src="a.png" alt="a &amp; b">'],
    ['an apostrophe', "<img src='a.png' alt='it is'>"],
  ])('the encoding of %s carries none of the characters that could break out', (_label, tag) => {
    const encoded = encodeHtmlSource(tag);
    expect(encoded).not.toMatch(/[<>&"]/);
    expect(decodeHtmlSource(encoded)).toBe(tag);
  });

  it('a value this module did not write is refused rather than trusted', () => {
    // A hand-written `data-html-source` in a user document reaches the same
    // attribute. It answers null, which puts the image on the markdown path —
    // the shape it would have had with no attribute at all.
    expect(decodeHtmlSource('not encoded at all')).toBeNull();
    expect(decodeHtmlSource('%E0%A4%A')).toBeNull();
    expect(decodeHtmlSource(encodeHtmlSource('<p>not an image</p>'))).toBeNull();
    expect(decodeHtmlSource(encodeHtmlSource('<img src=a.png><img src=b.png>'))).toBeNull();
    expect(decodeHtmlSource(null)).toBeNull();
    expect(decodeHtmlSource('')).toBeNull();
  });
});

describe('the stamp the parser writes', () => {
  it('gives a tag its own bytes', () => {
    const raw = '<img src=a.png alt=x width=600>';
    const stamped = stampImageSources(raw);
    expect(readTagAttribute(stamped, IMAGE_HTML_SOURCE_ATTRIBUTE)).toBe(encodeHtmlSource(raw));
    expect(decodeHtmlSource(readTagAttribute(stamped, IMAGE_HTML_SOURCE_ATTRIBUTE))).toBe(raw);
  });

  it('gives each of two images its own bytes, with no pairing', () => {
    const first = '<img src="a.png" width="1">';
    const second = '<img src=b.png width=2>';
    const stamped = stampImageSources(`${first} and ${second}`);
    const spans = imageTagSpans(stamped);
    expect(spans).toHaveLength(2);
    const sources = spans.map(([start, end]) =>
      decodeHtmlSource(readTagAttribute(stamped.slice(start, end), IMAGE_HTML_SOURCE_ATTRIBUTE)),
    );
    expect(sources).toEqual([first, second]);
  });

  it('leaves text with no image in it exactly as it was', () => {
    expect(stampImageSources('<p>text</p>\n')).toBe('<p>text</p>\n');
  });

  it('keeps the bytes around the tag, newline included', () => {
    const stamped = stampImageSources('before <img src="a.png"> after\n');
    expect(stamped.startsWith('before <img ')).toBe(true);
    expect(stamped.endsWith('> after\n')).toBe(true);
  });

  it('does not stamp over a value the file already carried', () => {
    const raw = `<img src="a.png" ${IMAGE_HTML_SOURCE_ATTRIBUTE}="whatever">`;
    expect(stampImageSources(raw)).toBe(raw);
  });
});

describe('a size is a positive whole number of pixels or it is nothing', () => {
  it.each([
    ['600', 600],
    ['1', 1],
    [' 600 ', 600],
    ['0', null],
    ['-5', null],
    ['60%', null],
    ['6.5', null],
    ['auto', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%s reads as %s', (raw, expected) => {
    expect(pixelValue(raw)).toBe(expected);
  });
});
