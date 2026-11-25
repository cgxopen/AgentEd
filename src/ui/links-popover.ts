import type { DocumentLink, LinkCheckResult, NotCheckedReason } from '../app/link-check';
import { MAX_CHECKED_LINKS } from '../app/link-check';
import { hasWebAddressShape } from '../platform/link-target';
import { basename } from '../platform/paths';

/**
 * The list the «Links» badge opens (#729): the broken links of the open
 * document first, each naming its target, then, apart, the links that could
 * not be checked, each with its reason. A click on a row puts the caret on
 * that link. It repairs nothing.
 *
 * It is the second popover of the header and takes the class of the first,
 * `header-popover`, so both are placed and drawn by one rule.
 */

export const LINKS_POPOVER_HEADING = 'Broken links in this document';
/**
 * The heading of the links AgentEd looked at and could not answer for, each
 * with its reason below it: Could not be checked since #781 (owner decision of
 * 2026-11-24), where Not checked read as a check that had not run yet.
 */
export const LINKS_NOT_CHECKED_HEADING = 'Could not be checked';

/**
 * How a web address is written (#792, owner decision of 2026-11-24): the
 * sentence after the one of today, for a link that has the shape of a web
 * address written without its scheme and leads nowhere, under the link here,
 * in the report of a folder, and at Ctrl and a click (`relative-link.ts`
 * imports it), typed once. It begins with If because the shape is a guess
 * (`hasWebAddressShape`).
 */
export const WEB_ADDRESS_HOW =
  'If this is a web address, write it with https:// in front, such as https://www.example.com.';

/** `line`, followed by the sentence of how when `address` has the shape of a web address. */
export function withWebAddressHow(line: string, address: string | undefined): string {
  return address !== undefined && hasWebAddressShape(address) ? `${line} ${WEB_ADDRESS_HOW}` : line;
}

/**
 * The line under a broken link: its target by name, and, for an address with
 * the shape of a web address, how a web address is written (#792).
 */
export function brokenLinkLine(path: string, address?: string): string {
  return withWebAddressHow(`${basename(path)} was not found.`, address);
}

/**
 * How a link that starts with / is written instead (#779, owner decision of
 * 2026-11-24): the second sentence after the one that says why, under Not
 * checked here and at Ctrl and a click (`RELATIVE_LINK_MESSAGES` of
 * `relative-link.ts`, which imports it), so the two places say it in one way.
 */
export const ROOTED_LINK_HOW =
  'Write it from the folder of the file it is in, such as other.md, notes/other.md, or ../notes/other.md for a folder one level up.';

/** The line under a link that was not checked: why, and for a link starting with /, how. */
export const NOT_CHECKED_LINES: Readonly<Record<NotCheckedReason, string>> = {
  'anchor-only': 'A link to a heading cannot be checked yet.',
  rooted: `A link that starts with / is not checked, since AgentEd does not know the folder it starts from. ${ROOTED_LINK_HOW}`,
  'no-document': 'Save this document first: links are checked from its folder.',
  folder: 'This link names a folder; only links to files are checked.',
  'above-root': 'This link goes above the top folder of the disk, so it is not checked.',
  unknown: 'AgentEd could not look in the folder of this link, so it is not checked.',
  'too-many': `Only the first ${MAX_CHECKED_LINKS} links of a document are checked.`,
};

/**
 * The line under a link that was not checked, and, for one refused as naming
 * a folder whose address has the shape of a web address, how a web address is
 * written (#792): `www.gnu.org/software/bash/` ends with a slash, measured in
 * the census on #792.
 */
export function notCheckedLine(reason: NotCheckedReason, address?: string): string {
  const line = NOT_CHECKED_LINES[reason];
  return reason === 'folder' ? withWebAddressHow(line, address) : line;
}

export interface LinksPopoverCallbacks {
  /** Put the caret on `link` in the document. */
  onJump: (link: DocumentLink) => void;
}

export interface LinksPopover {
  toggle: () => void;
  close: () => void;
  isOpen: () => boolean;
  /** The result of the last check; redrawn at once when the list is open. */
  show: (result: LinkCheckResult) => void;
}

export function setupLinksPopover(callbacks: LinksPopoverCallbacks): LinksPopover {
  const popoverEl = document.getElementById('links-popover');
  const badge = document.getElementById('badge-links');
  if (!popoverEl) {
    return { toggle: () => {}, close: () => {}, isOpen: () => false, show: () => {} };
  }
  const popover = popoverEl;
  let result: LinkCheckResult = { broken: [], notChecked: [], good: 0 };

  function isOpen(): boolean {
    return !popover.classList.contains('hidden');
  }

  function setExpanded(expanded: boolean): void {
    badge?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function close(): void {
    popover.classList.add('hidden');
    popover.replaceChildren();
    setExpanded(false);
  }

  function row(link: DocumentLink, line: string): HTMLElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'links-row';
    const address = document.createElement('span');
    address.className = 'links-row-address';
    address.textContent = link.href;
    const why = document.createElement('span');
    why.className = 'links-row-line';
    why.textContent = line;
    button.append(address, why);
    button.addEventListener('click', () => {
      close();
      callbacks.onJump(link);
    });
    item.append(button);
    return item;
  }

  function render(): void {
    const heading = document.createElement('div');
    heading.className = 'header-popover-heading';
    heading.textContent = LINKS_POPOVER_HEADING;
    const broken = document.createElement('ul');
    broken.className = 'links-list';
    for (const b of result.broken) broken.append(row(b.link, brokenLinkLine(b.path, b.link.href)));
    const parts: HTMLElement[] = [heading, broken];
    if (result.notChecked.length > 0) {
      const apart = document.createElement('div');
      apart.className = 'links-apart-heading';
      apart.textContent = LINKS_NOT_CHECKED_HEADING;
      const unchecked = document.createElement('ul');
      unchecked.className = 'links-list';
      for (const u of result.notChecked)
        unchecked.append(row(u.link, notCheckedLine(u.reason, u.link.href)));
      parts.push(apart, unchecked);
    }
    popover.replaceChildren(...parts);
  }

  function toggle(): void {
    if (isOpen()) {
      close();
      return;
    }
    render();
    popover.classList.remove('hidden');
    setExpanded(true);
  }

  function show(next: LinkCheckResult): void {
    result = next;
    if (!isOpen()) return;
    // Nothing broken any more: the badge withdraws, and its list with it.
    if (next.broken.length === 0) close();
    else render();
  }

  // The shape of the «Images» popover, for the reason `assets-popover.ts`
  // gives: capture, with the trigger excused, keeps the header popovers
  // mutually exclusive and lets the badge close its own list.
  document.addEventListener(
    'click',
    (e) => {
      if (!isOpen()) return;
      const target = e.target as Node;
      if (popover.contains(target)) return;
      if (badge?.contains(target)) return;
      close();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });
  popover.addEventListener('click', (e) => e.stopPropagation());

  return { toggle, close, isOpen, show };
}
