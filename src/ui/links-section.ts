import type { FolderCheck } from '../app/folder-link-check';
import type { DocumentLink, LinkCheckResult } from '../app/link-check';
import { samePath } from '../platform/paths';
import {
  FOLDER_CHECK_RING_CLASS,
  FOLDER_CHECK_STOP,
  FOLDER_RENAMED_LINE,
  onlyFirstFilesLine,
  runningText,
  stoppedLine,
} from './links-folder-report';

/**
 * The section of the files panel that shows, for the open document, the files
 * it links to and the files of the folder that link to it (#797, owner
 * decisions of 2026-11-25). It is for moving between files: a link that is
 * broken, could not be checked or has the shape of a web address stays with
 * the Links badge and the report of the folder, and is no row here.
 *
 * **Links to** is read from the check of the open document (#729), so it is
 * drawn at once and follows each open and save. **Linked from** is read from
 * the read of the folder (#766), by a scan of the found links of each file it
 * read, so it is as old as that read; its age is said only by the line of a
 * rename, as the report says it.
 */

export const SHOW_LINKS = 'Show links';
export const HIDE_LINKS = 'Hide links';
export const LINKS_TO_HEADING = 'Links to';
export const LINKED_FROM_HEADING = 'Linked from';
export const NO_LINKS_TO = 'No links to other files';
export const NO_LINKED_FROM = 'No file of this folder links here';
export const LINKS_SECTION_LABEL = 'Links of this document';
export const LINKS_SECTION_ID = 'sidebar-links-section';

/**
 * Rows drawn in one list, then one line counts the rest (owner decision 6 of
 * 2026-11-25). Measured on #797 over the census and the public corpus: no list
 * passed 111 files, and only `book/src/SUMMARY.md` of rust-lang/book passed
 * this, while one document may hold up to 5000 checked links (#729).
 */
export const SECTION_ROWS = 100;

/** The line under a list cut at `SECTION_ROWS`. */
export function moreFilesLine(more: number): string {
  return `${more} more file${more === 1 ? '' : 's'} not listed`;
}

/** What the section draws for the open document. */
export interface LinksSectionView {
  /** The folder the panel shows, which a row names its file from. */
  readonly root: string;
  readonly documentPath: string;
  /** The check of the open document, or null before its first answer. */
  readonly open: LinkCheckResult | null;
  /** The read of the folder that stands, or null. */
  readonly read: FolderCheck | null;
  /** A read running: how far it has come. */
  readonly running: { readonly read: number; readonly total: number } | null;
  /** A file of the read was renamed since it ran. */
  readonly renamed: boolean;
}

export interface LinksSectionActions {
  /** Follow `link` as Ctrl and a click on it does. */
  readonly onFollow: (link: DocumentLink) => void;
  /** Open the markdown file at `path`, keeping the folder of the panel. */
  readonly onOpen: (path: string) => void;
  readonly onStop: () => void;
}

/** A file the document links to, with the first link that leads there. */
export interface LinkedFile {
  readonly path: string;
  readonly link: DocumentLink;
}

/**
 * The files the document links to, found on the disk, each once, of any kind
 * and wherever they are, in the order of the names a row shows.
 */
export function linksTo(open: LinkCheckResult, root: string): LinkedFile[] {
  const files: LinkedFile[] = [];
  // Bounded by the links the check found, each looked at once.
  for (const f of open.found) {
    if (!files.some((g) => samePath(g.path, f.path))) files.push({ path: f.path, link: f.link });
  }
  return files.sort((a, b) => shownName(a.path, root).localeCompare(shownName(b.path, root)));
}

/**
 * The markdown files of the read that link to `path`, each once and not the
 * document itself, by a scan of the found links of each file read: 4.3 ms at
 * the median at the bounds of a read, measured on #797, so no map is kept.
 */
export function linkedFrom(read: FolderCheck, path: string, root: string): string[] {
  return read.files
    .filter((f) => !samePath(f.path, path) && f.result?.found.some((t) => samePath(t.path, path)))
    .map((f) => f.path)
    .sort((a, b) => shownName(a, root).localeCompare(shownName(b, root)));
}

/**
 * The name a row gives its file: its path from the folder of the panel, with
 * `..` for each folder above it, so a file outside the folder is told apart.
 */
export function shownName(path: string, root: string): string {
  const target = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const base = root.replace(/\\/g, '/').split('/').filter(Boolean);
  let same = 0;
  while (same < base.length && same < target.length - 1 && base[same] === target[same]) same += 1;
  return [...Array(base.length - same).fill('..'), ...target.slice(same)].join('/');
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The line that shows and hides the section, beside the door or the actions of the report. */
export function drawShowLinks(shown: boolean, onToggle: () => void): HTMLButtonElement {
  const b = el(
    'button',
    'links-folder-action links-section-toggle',
    shown ? HIDE_LINKS : SHOW_LINKS,
  );
  b.type = 'button';
  b.setAttribute('aria-expanded', String(shown));
  b.setAttribute('aria-controls', LINKS_SECTION_ID);
  b.addEventListener('click', onToggle);
  return b;
}

function heading(text: string, count: number | null): HTMLElement {
  const h = el('div', 'links-section-heading', count === null ? text : `${text} · ${count}`);
  h.setAttribute('role', 'heading');
  h.setAttribute('aria-level', '3');
  return h;
}

function list(
  rows: ReadonlyArray<{ name: string; title: string; click: () => void }>,
): HTMLElement[] {
  const ul = el('ul', 'links-section-list');
  for (const row of rows.slice(0, SECTION_ROWS)) {
    const li = el('li', 'links-section-item');
    const b = el('button', 'links-section-row', row.name);
    b.type = 'button';
    b.title = row.title;
    b.addEventListener('click', row.click);
    li.append(b);
    ul.append(li);
  }
  const out: HTMLElement[] = [ul];
  if (rows.length > SECTION_ROWS)
    out.push(el('div', 'links-section-note', moreFilesLine(rows.length - SECTION_ROWS)));
  return out;
}

/** The running line of a read, as the report draws it, under Linked from. */
function runningLine(read: number, total: number, onStop: () => void): HTMLElement {
  const line = el('div', 'links-folder-line links-section-running');
  const ring = el('span', FOLDER_CHECK_RING_CLASS);
  ring.setAttribute('aria-hidden', 'true');
  const stop = el('button', 'links-folder-action', FOLDER_CHECK_STOP);
  stop.type = 'button';
  stop.addEventListener('click', onStop);
  line.append(
    ring,
    el('span', 'links-folder-count-text', runningText(read, total)),
    el('span', 'links-folder-dot', '·'),
    stop,
  );
  return line;
}

/** The two lists of the section, for the open document. */
export function drawLinksSection(
  view: LinksSectionView,
  actions: LinksSectionActions,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  const to = view.open ? linksTo(view.open, view.root) : [];
  out.push(heading(LINKS_TO_HEADING, view.open ? to.length : null));
  if (view.open && to.length === 0) out.push(el('div', 'links-section-note', NO_LINKS_TO));
  out.push(
    ...list(
      to.map((f) => ({
        name: shownName(f.path, view.root),
        title: f.path,
        click: () => actions.onFollow(f.link),
      })),
    ),
  );

  if (view.running) {
    out.push(heading(LINKED_FROM_HEADING, null));
    out.push(runningLine(view.running.read, view.running.total, actions.onStop));
    return out;
  }
  if (!view.read) return out;
  const from = linkedFrom(view.read, view.documentPath, view.root);
  out.push(heading(LINKED_FROM_HEADING, from.length));
  if (from.length === 0) out.push(el('div', 'links-section-note', NO_LINKED_FROM));
  out.push(
    ...list(
      from.map((path) => ({
        name: shownName(path, view.root),
        title: path,
        click: () => actions.onOpen(path),
      })),
    ),
  );
  if (view.read.stopped)
    out.push(el('div', 'links-section-note', stoppedLine(view.read.read, view.read.total)));
  if (view.read.bound !== null)
    out.push(el('div', 'links-section-note', onlyFirstFilesLine(view.read.read)));
  if (view.renamed) out.push(el('div', 'links-section-note', FOLDER_RENAMED_LINE));
  return out;
}
