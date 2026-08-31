/**
 * The R-C12 document-kind badges at the level they are drawn.
 *
 * The markup is read out of `index.html` rather than restated here, so a
 * badge deleted from the shipped page fails these tests instead of
 * passing them against a copy. `statusbar.test.ts` reads the page the
 * same way and for the same reason.
 *
 * The routes — a document opened, a metadata block emptied in the panel
 * — live in `src/app/document-badges-flow.test.ts`. What is here is the
 * badge itself: what it says, what withdrawing it means, and what the
 * overflow menu does with it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { isOfferedInOverflow } from '../app/header-wiring';
import { createEditor, type EditorInstance } from '../editor/setup';
import {
  anyImageIn,
  type DocumentBadges,
  documentReferencesImage,
  IMAGES_BADGE_LABEL,
  IMAGES_BADGE_TOOLTIP,
  METADATA_BADGE_LABEL,
  METADATA_BADGE_TOOLTIP,
  setupDocumentBadges,
  type WalkableNode,
} from './document-badges';

vi.mock('./toast', () => ({ showToast: vi.fn() }));

/**
 * The indicator row exactly as `index.html` ships it.
 *
 * Sliced out of the page text rather than parsed from it: parsing the
 * whole document makes happy-dom go and fetch the stylesheet and the
 * module script the page links, which no test here is about. The slice
 * still fails loudly if the row is renamed or removed.
 */
function mountShippedRow(): void {
  const start = shippedPage.indexOf('<div id="header-indicators">');
  const end = shippedPage.indexOf('</div>', start);
  if (start === -1 || end === -1) {
    throw new Error('index.html no longer has a #header-indicators block');
  }
  document.body.innerHTML = shippedPage.slice(start, end + '</div>'.length);
}

/**
 * What the collapse breakpoint does to an element, as
 * `isOfferedInOverflow` reads it.
 *
 * `offsetParent` is layout and happy-dom has none — it answers
 * `undefined` for every element, which is neither of the two states the
 * predicate distinguishes. So the layout fact is set by hand, which is
 * the reason `header-wiring` exports the predicate at all.
 */
function setTakenOutOfTheBar(el: HTMLElement, takenOut: boolean): void {
  Object.defineProperty(el, 'offsetParent', {
    value: takenOut ? null : document.body,
    configurable: true,
  });
}

let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

let onImagesToggle: ReturnType<typeof vi.fn<() => void>>;

function badges(markdown = '# Plain\n\nNo pictures here.\n'): DocumentBadges {
  mountShippedRow();
  const editor = editorWith(markdown);
  onImagesToggle = vi.fn();
  return setupDocumentBadges(editor.editor, { onImagesToggle });
}

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`${id} is not in the shipped indicator row`);
  return found;
}

/** The four things withdrawing a badge has to be (#130). */
function isFullyWithdrawn(badge: HTMLElement): boolean {
  return (
    badge.style.display === 'none' &&
    badge.getAttribute('aria-hidden') === 'true' &&
    badge.textContent === '' &&
    badge.title === ''
  );
}

beforeEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('what the shipped page declares', () => {
  it('ships both badges withdrawn, so a plain document shows neither', () => {
    mountShippedRow();
    for (const id of ['badge-metadata', 'badge-images']) {
      const badge = el(id);
      expect(badge.style.display).toBe('none');
      expect(badge.getAttribute('aria-hidden')).toBe('true');
      expect(badge.textContent).toBe('');
    }
  });

  it('puts «Metadata» before «Images», and both before the context indicator', () => {
    mountShippedRow();
    const order = Array.from(
      document.querySelectorAll<HTMLElement>('#header-indicators .indicator'),
    ).map((node) => node.id);
    expect(order.indexOf('badge-metadata')).toBeLessThan(order.indexOf('badge-images'));
    expect(order.indexOf('badge-images')).toBeLessThan(order.indexOf('cluster-indicator'));
  });

  it('gives both badges the context indicator’s breakpoint', () => {
    mountShippedRow();
    for (const id of ['badge-metadata', 'badge-images']) {
      expect(el(id).classList.contains('indicator-collapse-600')).toBe(true);
    }
    expect(el('cluster-indicator').classList.contains('indicator-collapse-600')).toBe(true);
  });

  it('makes «Metadata» hover-only and «Images» clickable', () => {
    mountShippedRow();
    // R-C12 gives a click to «Images» alone. A `span` cannot be tabbed to
    // or activated by keyboard, which is the statement that it is not a
    // control — the same shape the token count uses.
    expect(el('badge-metadata').tagName).toBe('SPAN');
    expect(el('badge-images').tagName).toBe('BUTTON');
    expect(el('badge-images').getAttribute('aria-controls')).toBe('assets-popover');
  });
});

describe('«Metadata» (R-C12)', () => {
  // Criterion 5 of the issue: pinned on literal bytes rather than on a
  // value this module also produces. An assertion built from the same
  // constant the code reads would pass for any wording at all (#173).
  it('says exactly what R-C12 gives as the example wording', () => {
    const rendered = badges();
    rendered.refreshMetadata('title: x');

    expect(el('badge-metadata').textContent).toBe('Metadata');
    expect(el('badge-metadata').title).toBe(
      'This document starts with a metadata block (YAML frontmatter)',
    );
    // The constants and the bytes above must not drift apart.
    expect(METADATA_BADGE_LABEL).toBe('Metadata');
    expect(METADATA_BADGE_TOOLTIP).toBe(
      'This document starts with a metadata block (YAML frontmatter)',
    );
  });

  it('avoids the jargon R-C12 names', () => {
    const rendered = badges();
    rendered.refreshMetadata('title: x');
    // "Metadata", not "Frontmatter" — the label is what a user reads at a
    // glance. The tooltip is allowed the technical word in parentheses,
    // and R-C12's own example puts it there.
    expect(el('badge-metadata').textContent).not.toMatch(/frontmatter/i);
  });

  it('withdraws completely when the document carries no metadata block', () => {
    const rendered = badges();
    rendered.refreshMetadata('title: x');
    expect(isFullyWithdrawn(el('badge-metadata'))).toBe(false);

    rendered.refreshMetadata(null);
    expect(isFullyWithdrawn(el('badge-metadata'))).toBe(true);
  });

  it('treats an empty metadata block as a block, because the document has one', () => {
    const rendered = badges();
    // `null` is "no block"; `''` cannot arise from the panel, which maps
    // an emptied textarea to `null`, but the split of a file that opens
    // with `---`⏎`---` can produce it. A document that carries the
    // delimiters carries a block.
    rendered.refreshMetadata('');
    expect(el('badge-metadata').textContent).toBe(METADATA_BADGE_LABEL);
  });
});

describe('«Images» (R-C12)', () => {
  it('says exactly its label and tooltip', () => {
    const rendered = badges('# T\n\n![a](assets/x.png)\n');
    rendered.refreshImages();

    expect(el('badge-images').textContent).toBe('Images');
    expect(el('badge-images').title).toBe('This document references images — click for details');
    expect(IMAGES_BADGE_LABEL).toBe('Images');
    expect(IMAGES_BADGE_TOOLTIP).toBe('This document references images — click for details');
  });

  it('withdraws completely for a document that references none', () => {
    const rendered = badges('# T\n\nJust words.\n');
    rendered.refreshImages();
    expect(isFullyWithdrawn(el('badge-images'))).toBe(true);
  });

  it('opens the popover when clicked, and only then', () => {
    const rendered = badges('# T\n\n![a](assets/x.png)\n');
    rendered.refreshImages();
    expect(onImagesToggle).not.toHaveBeenCalled();

    el('badge-images').click();
    expect(onImagesToggle).toHaveBeenCalledTimes(1);
  });
});

describe('what counts as referencing an image', () => {
  // Step zero 3 of the issue: the states enumerated before the predicate
  // was chosen, and each one's answer recorded rather than assumed.
  const YES: Array<[string, string]> = [
    ['a markdown reference into assets/', '# T\n\n![a](assets/x.png)\n'],
    ['a reference with no file behind it', '# T\n\n![a](missing.png)\n'],
    ['an image outside assets/', '# T\n\n![a](../pics/x.png)\n'],
    ['an <img> written as raw HTML', '# T\n\n<img src="assets/y.png" alt="y">\n'],
    ['a remote image', '# T\n\n![a](https://example.com/x.png)\n'],
    ['a reference-style image', '# T\n\n![a][ref]\n\n[ref]: assets/z.png\n'],
    ['an image inside a link', '# T\n\n[![a](assets/x.png)](https://e.com)\n'],
    ['an image inside a list item', '# T\n\n- ![a](assets/x.png)\n'],
  ];

  for (const [name, markdown] of YES) {
    it(`answers yes to ${name}`, () => {
      expect(documentReferencesImage(editorWith(markdown).editor)).toBe(true);
    });
  }

  it('answers no to a document with no reference at all', () => {
    expect(documentReferencesImage(editorWith('# T\n\nJust words.\n').editor)).toBe(false);
  });

  it('answers no to text that merely looks like a reference', () => {
    // Inside a code span it is literal text and no image node exists.
    expect(documentReferencesImage(editorWith('# T\n\n`![a](assets/x.png)`\n').editor)).toBe(false);
  });

  it('answers no to a document whose only claim to images is a folder beside it', () => {
    // The state the predicate answers against a literal reading of
    // R-C12's "references images/assets", and the one the module's
    // comment argues for: R-C5 says the badge is derived from content,
    // and a folder somebody left next to the file is not this document's
    // content. Nothing about an `assets/` folder reaches this function —
    // which is the assertion.
    expect(documentReferencesImage(editorWith('# T\n\nNo pictures.\n').editor)).toBe(false);
  });
});

describe('the walk returns at the first image', () => {
  /** A node tree that records how many of its nodes the walk touched. */
  function tree(spec: { name: string; children?: unknown[] }, visited: string[]): WalkableNode {
    const children = (spec.children ?? []) as Array<{ name: string; children?: unknown[] }>;
    return {
      get type() {
        visited.push(spec.name);
        return { name: spec.name };
      },
      get childCount() {
        return children.length;
      },
      child: (index: number) => tree(children[index], visited),
    };
  }

  it('stops at the image instead of walking what comes after it', () => {
    const visited: string[] = [];
    const root = tree(
      {
        name: 'doc',
        children: [
          { name: 'paragraph', children: [{ name: 'image' }] },
          { name: 'paragraph', children: [{ name: 'text' }] },
          { name: 'paragraph', children: [{ name: 'text' }] },
        ],
      },
      visited,
    );

    expect(anyImageIn(root)).toBe(true);
    // doc → first paragraph → image, and nothing else. Written as the
    // exact list rather than as a count, so a walk that reached the same
    // number of nodes by a different route still fails.
    expect(visited).toEqual(['doc', 'paragraph', 'image']);
  });

  it('walks in document order, so an image near the top is found early', () => {
    const visited: string[] = [];
    const root = tree(
      {
        name: 'doc',
        children: [{ name: 'image' }, { name: 'a' }, { name: 'b' }, { name: 'c' }],
      },
      visited,
    );

    expect(anyImageIn(root)).toBe(true);
    expect(visited).toEqual(['doc', 'image']);
  });

  it('answers no only after it has looked everywhere', () => {
    const visited: string[] = [];
    const root = tree(
      { name: 'doc', children: [{ name: 'a', children: [{ name: 'b' }] }, { name: 'c' }] },
      visited,
    );

    expect(anyImageIn(root)).toBe(false);
    expect(visited).toEqual(['doc', 'a', 'b', 'c']);
  });
});

describe('the overflow menu (#130)', () => {
  it('does not offer a withdrawn badge, at any width', () => {
    const rendered = badges('# T\n\nJust words.\n');
    rendered.refreshMetadata(null);
    rendered.refreshImages();

    // The breakpoint has taken both out of the bar, which is the one
    // state in which the menu would otherwise offer them. The withdrawal
    // statement alone has to be enough to refuse them anyway — that is
    // #130, and below 600px this menu is the only route there is.
    for (const id of ['badge-metadata', 'badge-images']) {
      setTakenOutOfTheBar(el(id), true);
      expect(isOfferedInOverflow(el(id))).toBe(false);
    }
  });

  it('offers a live badge that the breakpoint took out of the bar', () => {
    const rendered = badges('# T\n\n![a](assets/x.png)\n');
    rendered.refreshMetadata('title: x');
    rendered.refreshImages();

    // Neither badge has withdrawn itself now, so the only fact left is
    // the layout one — which is what the menu exists for. Without this
    // half the previous test would pass against a badge the menu never
    // offers under any circumstances.
    expect(el('badge-metadata').getAttribute('aria-hidden')).toBe(null);
    expect(el('badge-images').getAttribute('aria-hidden')).toBe(null);
    for (const id of ['badge-metadata', 'badge-images']) {
      setTakenOutOfTheBar(el(id), true);
      expect(isOfferedInOverflow(el(id))).toBe(true);
      // And while the bar still holds it, the menu leaves it alone.
      setTakenOutOfTheBar(el(id), false);
      expect(isOfferedInOverflow(el(id))).toBe(false);
    }
  });

  it('leaves nothing for the menu to clone once a badge withdraws', () => {
    const rendered = badges('# T\n\n![a](assets/x.png)\n');
    rendered.refreshMetadata('title: x');
    rendered.refreshImages();

    // The document is replaced by one that warrants neither.
    instance?.setMarkdown('# T\n\nJust words.\n');
    rendered.refreshMetadata(null);
    rendered.refreshImages();

    // The label and the tooltip are what the menu copies; if either
    // survived, the menu would offer a stale word and a dead click.
    for (const id of ['badge-metadata', 'badge-images']) {
      expect(isFullyWithdrawn(el(id))).toBe(true);
    }
  });
});
