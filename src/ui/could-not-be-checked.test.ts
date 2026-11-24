/**
 * #781 - the links AgentEd could not answer for are headed Could not be
 * checked, in the list of the open document and in the report of the folder,
 * one constant at one address; the words Not checked stand in no text a person
 * reads, and the sentences under each link are as they were.
 */
import { afterEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import type { FolderCheck } from '../app/folder-link-check';
import type { DocumentLink } from '../app/link-check';
import { shippedElement } from '../test-support/shipped-markup';
import {
  drawReport,
  FILE_TOO_LARGE_LINE,
  FILE_UNREAD_LINE,
  NOT_CHECKED_KEY,
} from './links-folder-report';
import { LINKS_NOT_CHECKED_HEADING, NOT_CHECKED_LINES, setupLinksPopover } from './links-popover';

const link = (href: string, i: number): DocumentLink => ({
  href,
  from: i,
  to: i + 1,
  text: href,
  occurrence: 0,
});

const check: FolderCheck = {
  files: [
    {
      path: '/notes/a.md',
      result: {
        broken: [{ link: link('gone.md', 1), path: '/notes/gone.md' }],
        notChecked: [
          { link: link('/x.md', 2), reason: 'rooted' },
          { link: link('#h', 3), reason: 'anchor-only' },
        ],
        good: 0,
      },
    },
    { path: '/notes/big.md', result: null, skipped: 'too-large' },
  ],
  read: 2,
  total: 2,
  stopped: false,
  bound: null,
};

function drawnReport(expanded: boolean): HTMLElement {
  return drawReport(
    {
      check,
      root: '/notes',
      expanded: new Set(expanded ? [NOT_CHECKED_KEY, '/notes/a.md'] : []),
      renamed: false,
    },
    { onAgain: () => {}, onClear: () => {}, onToggle: () => {}, onJump: () => {} },
  );
}

function drawnList(): HTMLElement {
  document.body.innerHTML = `${shippedElement(shippedPage, '<div id="header-indicators">')}${shippedElement(shippedPage, '<aside id="links-popover"')}`;
  const popover = setupLinksPopover({ onJump: () => {} });
  popover.show({
    broken: check.files[0].result?.broken ?? [],
    notChecked: check.files[0].result?.notChecked ?? [],
    good: 0,
  });
  popover.toggle();
  return document.getElementById('links-popover') as HTMLElement;
}

/** The text a person reads in `root`, without the sentences under each link, which say why. */
function textOutsideTheReasons(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  for (const why of copy.querySelectorAll('.links-row-line')) why.remove();
  return copy.textContent ?? '';
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the heading reads Could not be checked (#781, owner decision of 2026-11-24)', () => {
  it('row 1: the heading of the list of the open document', () => {
    expect(LINKS_NOT_CHECKED_HEADING).toBe('Could not be checked');
    expect(drawnList().querySelector('.links-apart-heading')?.textContent).toBe(
      'Could not be checked',
    );
  });

  it('row 2: the shut row of the report carries the same string, by the same constant', () => {
    const row = drawnReport(false).querySelector('.links-folder-apart .links-folder-name');
    expect(row?.textContent).toBe(LINKS_NOT_CHECKED_HEADING);
  });

  it('row 7: the words Not checked stand in no text a person reads, in the list or in the report', () => {
    for (const drawn of [drawnList(), drawnReport(false), drawnReport(true)]) {
      expect(textOutsideTheReasons(drawn)).not.toMatch(/not checked/i);
      expect(drawn.textContent).not.toContain('Not checked');
    }
  });
});

describe('the sentences under each link are byte for byte as on main (#781)', () => {
  it('the reasons of a link and of a whole file', () => {
    expect(NOT_CHECKED_LINES['anchor-only']).toBe('A link to a heading is not checked yet.');
    expect(NOT_CHECKED_LINES.unknown).toBe(
      'AgentEd could not look in the folder of this link, so it is not checked.',
    );
    expect(FILE_TOO_LARGE_LINE).toBe(
      'This file is larger than 512 KB, so its links are not checked.',
    );
    expect(FILE_UNREAD_LINE).toBe('This file could not be read.');
  });
});
