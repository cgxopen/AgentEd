/**
 * #779 - the sentence about a link that starts with / says how to write it, at
 * one address, in the list of the open document, in the report of the folder
 * and at Ctrl and a click; every other sentence stays as it was.
 */
import { describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import type { PlatformIO } from '../platform/types';
import { shippedElement } from '../test-support/shipped-markup';
import { drawReport, NOT_CHECKED_KEY } from '../ui/links-folder-report';
import { NOT_CHECKED_LINES, ROOTED_LINK_HOW, setupLinksPopover } from '../ui/links-popover';
import popoverSource from '../ui/links-popover.ts?raw';
import { followRelativeLink, RELATIVE_LINK_MESSAGES } from './relative-link';
import relativeLinkSource from './relative-link.ts?raw';

const WHY_NOT_CHECKED =
  'A link that starts with / is not checked, since AgentEd does not know the folder it starts from.';
const WHY_NOT_FOLLOWED =
  'A link that starts with / is not followed, since AgentEd does not know the folder it starts from.';
const HOW =
  'Write it from the folder of the file it is in, such as other.md, notes/other.md, or ../notes/other.md for a folder one level up.';

const rooted = { href: '/other.md', from: 1, to: 2, text: 'other', occurrence: 0 };

describe('the second sentence, how to write it (#779, owner decision of 2026-11-24)', () => {
  it('row 1: the line under a rooted link in the list of the open document holds it', () => {
    document.body.innerHTML = `${shippedElement(shippedPage, '<div id="header-indicators">')}${shippedElement(shippedPage, '<aside id="links-popover"')}`;
    const popover = setupLinksPopover({ onJump: () => {} });
    popover.show({ broken: [], notChecked: [{ link: rooted, reason: 'rooted' }], good: 0 });
    popover.toggle();
    const line = document.querySelector('#links-popover .links-row-line')?.textContent;
    expect(line).toBe(`${WHY_NOT_CHECKED} ${HOW}`);
    document.body.innerHTML = '';
  });

  it('row 2: the same line in the report of the folder is the same string', () => {
    const report = drawReport(
      {
        check: {
          files: [
            {
              path: '/notes/a.md',
              result: { broken: [], notChecked: [{ link: rooted, reason: 'rooted' }], good: 0 },
            },
          ],
          read: 1,
          total: 1,
          stopped: false,
          bound: null,
        },
        root: '/notes',
        expanded: new Set([NOT_CHECKED_KEY]),
        renamed: false,
      },
      { onAgain: () => {}, onClear: () => {}, onToggle: () => {}, onJump: () => {} },
    );
    expect(report.querySelector('.links-row-line')?.textContent).toBe(NOT_CHECKED_LINES.rooted);
    expect(NOT_CHECKED_LINES.rooted).toBe(`${WHY_NOT_CHECKED} ${HOW}`);
  });

  it('row 3: Ctrl and a click on a rooted link tells the sentence of #727 and the same second sentence', async () => {
    const told: string[] = [];
    await followRelativeLink(
      {
        documentPath: () => '/notes/a.md',
        panelRoot: () => null,
        io: async () => ({}) as PlatformIO,
        openFilePath: async () => {},
        tell: (message) => told.push(message),
      },
      '/other.md',
    );
    expect(told).toEqual([`${WHY_NOT_FOLLOWED} ${HOW}`]);
  });

  it('row 4: the second sentence exists at one address, and both constants are built from it', () => {
    expect(ROOTED_LINK_HOW).toBe(HOW);
    const count = (source: string) =>
      source.split('Write it from the folder of the file it is in').length - 1;
    expect(count(popoverSource)).toBe(1);
    expect(count(relativeLinkSource)).toBe(0);
    expect(relativeLinkSource).toContain('${ROOTED_LINK_HOW}');
    expect(popoverSource).toContain('${ROOTED_LINK_HOW}');
  });
});

describe('every other sentence is byte for byte as on main (#779)', () => {
  it('the six other reasons under Not checked', () => {
    const { rooted: _rooted, 'too-many': tooMany, ...others } = NOT_CHECKED_LINES;
    expect(others).toEqual({
      'anchor-only': 'A link to a heading cannot be checked yet.', // #784, owner wording
      'no-document': 'Save this document first: links are checked from its folder.',
      folder: 'This link names a folder; only links to files are checked.',
      'above-root': 'This link goes above the top folder of the disk, so it is not checked.',
      unknown: 'AgentEd could not look in the folder of this link, so it is not checked.',
    });
    expect(tooMany).toBe('Only the first 5000 links of a document are checked.');
  });

  it('the other messages of a link that is not followed', () => {
    const { rooted: _rooted, ...others } = RELATIVE_LINK_MESSAGES;
    expect(others).toEqual({
      'not-relative': '',
      'anchor-only': 'Going to a heading of the document is not supported yet.',
      'no-document':
        'Save this document first: a relative link is followed from the folder of the document.',
      folder: 'This link names a folder; AgentEd opens markdown files.',
      'above-root': 'This link goes above the top folder of the disk, so it is not followed.',
    });
  });
});
