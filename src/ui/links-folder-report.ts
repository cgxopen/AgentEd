import { type FileCheck, type FolderCheck, MAX_FILE_BYTES } from '../app/folder-link-check';
import type { DocumentLink } from '../app/link-check';
import { basename } from '../platform/paths';
import { brokenLinkLine, LINKS_NOT_CHECKED_HEADING, notCheckedLine } from './links-popover';

/**
 * What the check of the folder of the files panel draws (#766), under the
 * name of the folder and above the tree: the door, the line of a check
 * running, or the report. Built from what it is given and holding nothing, so
 * a redraw of the panel draws it again as it was.
 *
 * The rows of a link take the classes of the «Links» list of #729
 * (`links-row`, `links-row-address`, `links-row-line`), so a broken link reads
 * the same in both.
 */

export const FOLDER_CHECK_DOOR = 'Check links in this folder';
export const FOLDER_CHECK_STOP = 'Stop';
export const FOLDER_CHECK_AGAIN = 'Check again';
export const FOLDER_CHECK_CLEAR = 'Clear';
export const FOLDER_REPORT_LABEL = 'Broken links in this folder';
export const FOLDER_RENAMED_LINE = 'A file was renamed since this check.';
export const FILE_TOO_LARGE_LINE = `This file is larger than ${MAX_FILE_BYTES / 1000} KB, so its links are not checked.`;
export const FILE_UNREAD_LINE = 'This file could not be read.';

/** The class of the one line under the name of the folder: the door, or the check running. */
export const FOLDER_CHECK_LINE_CLASS = 'links-folder-line';
/** The class of the turning mark of a check running (#766, the ring of #354, small). */
export const FOLDER_CHECK_RING_CLASS = 'links-folder-ring';

function files(n: number): string {
  return `${n} file${n === 1 ? '' : 's'}`;
}

/** The words of the line while a check runs, before Stop. */
export function runningText(read: number, total: number): string {
  return `Checking… ${read} of ${total}`;
}

/** What a screen reader is told once, when a check starts. */
export function startedText(total: number): string {
  return `Checking links in ${files(total)}`;
}

export function stoppedLine(read: number, total: number): string {
  return `Stopped after ${read} of ${total} files.`;
}

export function onlyFirstFilesLine(read: number): string {
  return `Only the first ${files(read)} were checked.`;
}

export function brokenCount(check: FolderCheck): { broken: number; inFiles: number } {
  let broken = 0;
  let inFiles = 0;
  for (const file of check.files) {
    const n = file.result?.broken.length ?? 0;
    broken += n;
    if (n > 0) inFiles += 1;
  }
  return { broken, inFiles };
}

/**
 * The relative links of the files read, each good, broken or not checked, and
 * each file that could not be read, which may hold some (#792). The result of
 * a file places every relative link in exactly one of its three lists, and the
 * row of the open file kept current by #729 is a whole result, so the sum stays
 * right. Web addresses are not among them: the check never looks at them.
 */
export function linksToCheck(check: FolderCheck): number {
  return check.files.reduce(
    (n, f) =>
      n + (f.result ? f.result.good + f.result.broken.length + f.result.notChecked.length : 1),
    0,
  );
}

/**
 * The first line of the report: what was found, over the files read. With no
 * link to another file in any file read, it says there was nothing to check
 * (#792, owner decision of 2026-11-24), where No broken links would claim a
 * check of links that were not there.
 */
export function countsLine(check: FolderCheck): string {
  const { broken, inFiles } = brokenCount(check);
  if (linksToCheck(check) === 0) return `No links to check in ${files(check.read)}`;
  if (broken === 0) return `No broken links in ${files(check.read)}`;
  return `${broken} broken link${broken === 1 ? '' : 's'} in ${inFiles} of ${files(check.read)}`;
}

/**
 * The line under the first one, when there are any (#779, a line of its own
 * since #781): how many links AgentEd could not answer for, the count of the
 * shut row below, so a link moved from broken to that row is not read as
 * repaired. Its own line, because with the count at the end of the first line
 * that line took three lines of the 220 px of the panel whenever something was
 * broken, measured on #781.
 */
export function couldNotBeCheckedLine(check: FolderCheck): string | null {
  const unchecked = notCheckedCount(check);
  return unchecked > 0 ? `${unchecked} could not be checked` : null;
}

/** How many entries the shut row holds: each link not checked, and each file not read. */
export function notCheckedCount(check: FolderCheck): number {
  return check.files.reduce((n, f) => n + (f.result ? f.result.notChecked.length : 1), 0);
}

export interface FolderReportView {
  readonly check: FolderCheck;
  /** The root of the folder, so a row names its file from there. */
  readonly root: string;
  /** Which rows are open: a file by its path, Could not be checked by `NOT_CHECKED_KEY`. */
  readonly expanded: ReadonlySet<string>;
  readonly renamed: boolean;
}

export const NOT_CHECKED_KEY = '\u0000not-checked';

export interface FolderReportActions {
  readonly onAgain: () => void;
  readonly onClear: () => void;
  readonly onToggle: (key: string) => void;
  readonly onJump: (path: string, link: DocumentLink) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function textButton(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'links-folder-action', text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** The door, under the name of the folder. */
export function drawDoor(onCheck: () => void): HTMLElement {
  const line = el('div', FOLDER_CHECK_LINE_CLASS);
  line.append(textButton(FOLDER_CHECK_DOOR, onCheck));
  return line;
}

/**
 * The line of a check running: the turning mark, the count, and Stop. The
 * mark is hidden from a screen reader, which is told once when the check
 * starts and once when it ends, through the status line of the panel, so a
 * count changing at every file is not read out.
 */
export function drawRunning(read: number, total: number, onStop: () => void): HTMLElement {
  const line = el('div', FOLDER_CHECK_LINE_CLASS);
  const ring = el('span', FOLDER_CHECK_RING_CLASS);
  ring.setAttribute('aria-hidden', 'true');
  line.append(
    ring,
    el('span', 'links-folder-count-text', runningText(read, total)),
    el('span', 'links-folder-dot', '·'),
  );
  line.append(textButton(FOLDER_CHECK_STOP, onStop));
  return line;
}

/** The name a row gives its file: its path below the root of the folder. */
function shownName(path: string, root: string): string {
  const prefix = root.endsWith('/') || root.endsWith('\\') ? root : `${root}/`;
  const slashed = path.replace(/\\/g, '/');
  const rootSlashed = prefix.replace(/\\/g, '/');
  return slashed.startsWith(rootSlashed) ? slashed.slice(rootSlashed.length) : basename(path);
}

function linkRow(
  path: string,
  link: DocumentLink,
  line: string,
  actions: FolderReportActions,
): HTMLElement {
  const item = document.createElement('li');
  const button = el('button', 'links-row');
  button.type = 'button';
  button.title = link.href;
  button.append(el('span', 'links-row-address', link.href), el('span', 'links-row-line', line));
  button.addEventListener('click', () => actions.onJump(path, link));
  item.append(button);
  return item;
}

function openingRow(
  key: string,
  name: string,
  count: number,
  view: FolderReportView,
  actions: FolderReportActions,
  extra = '',
): HTMLButtonElement {
  const row = el('button', `links-folder-file${extra}`);
  row.type = 'button';
  row.title = name;
  row.dataset.key = key;
  row.setAttribute('aria-expanded', view.expanded.has(key) ? 'true' : 'false');
  row.append(
    el('span', 'links-folder-name', name),
    el('span', 'links-folder-count', String(count)),
  );
  row.addEventListener('click', () => actions.onToggle(key));
  return row;
}

function brokenRows(
  file: FileCheck,
  view: FolderReportView,
  actions: FolderReportActions,
): HTMLElement[] {
  const broken = file.result?.broken ?? [];
  if (broken.length === 0) return [];
  const rows: HTMLElement[] = [
    openingRow(file.path, shownName(file.path, view.root), broken.length, view, actions),
  ];
  if (view.expanded.has(file.path)) {
    const list = el('ul', 'links-folder-links');
    for (const b of broken)
      list.append(linkRow(file.path, b.link, brokenLinkLine(b.path, b.link.href), actions));
    rows.push(list);
  }
  return rows;
}

function notCheckedRows(view: FolderReportView, actions: FolderReportActions): HTMLElement[] {
  const count = notCheckedCount(view.check);
  if (count === 0) return [];
  const rows: HTMLElement[] = [
    openingRow(
      NOT_CHECKED_KEY,
      LINKS_NOT_CHECKED_HEADING,
      count,
      view,
      actions,
      ' links-folder-apart',
    ),
  ];
  if (!view.expanded.has(NOT_CHECKED_KEY)) return rows;
  const list = el('ul', 'links-folder-links');
  for (const file of view.check.files) {
    if (file.result !== null && file.result.notChecked.length === 0) continue;
    list.append(el('li', 'links-folder-subhead', shownName(file.path, view.root)));
    if (file.result === null) {
      const why = file.skipped === 'too-large' ? FILE_TOO_LARGE_LINE : FILE_UNREAD_LINE;
      list.append(el('li', 'links-row-line links-folder-file-line', why));
      continue;
    }
    for (const u of file.result.notChecked)
      list.append(linkRow(file.path, u.link, notCheckedLine(u.reason, u.link.href), actions));
  }
  rows.push(list);
  return rows;
}

/** The report, above the tree. */
export function drawReport(view: FolderReportView, actions: FolderReportActions): HTMLElement {
  const box = el('section', 'links-folder-report');
  box.setAttribute('aria-label', FOLDER_REPORT_LABEL);
  const head = el('div', 'links-folder-head');
  head.append(el('div', 'links-folder-counts', countsLine(view.check)));
  const couldNot = couldNotBeCheckedLine(view.check);
  if (couldNot !== null) head.append(el('div', 'links-folder-note', couldNot));
  if (view.check.stopped)
    head.append(el('div', 'links-folder-note', stoppedLine(view.check.read, view.check.total)));
  if (view.check.bound !== null)
    head.append(el('div', 'links-folder-note', onlyFirstFilesLine(view.check.read)));
  if (view.renamed) head.append(el('div', 'links-folder-note', FOLDER_RENAMED_LINE));
  const buttons = el('div', 'links-folder-actions');
  buttons.append(
    textButton(FOLDER_CHECK_AGAIN, actions.onAgain),
    textButton(FOLDER_CHECK_CLEAR, actions.onClear),
  );
  head.append(buttons);
  box.append(head);
  for (const file of view.check.files) box.append(...brokenRows(file, view, actions));
  box.append(...notCheckedRows(view, actions));
  return box;
}
