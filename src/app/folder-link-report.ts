import type { Schema } from '@tiptap/pm/model';
import { samePath } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import {
  countsLine,
  drawDoor,
  drawReport,
  drawRunning,
  FOLDER_CHECK_AGAIN,
  FOLDER_CHECK_DOOR,
  onlyFirstFilesLine,
  runningText,
  startedText,
  stoppedLine,
} from '../ui/links-folder-report';
import type { DrawnMarkdownTree, TreeRoot } from '../ui/sidebar';
import {
  checkFolder,
  type FolderCheck,
  MAX_FOLDER_FILES,
  markdownFilesOf,
  type OpenDocument,
} from './folder-link-check';
import type { DocumentLink, LinkCheckResult } from './link-check';

/**
 * The check of the folder of the files panel and its report, over the life of
 * the panel (#766, owner decision of 2026-11-24).
 *
 * **The report belongs to the folder the panel shows.** A redraw of the same
 * folder, a save or a document switch within it, draws it again as it was.
 * Another folder, a panel hidden (the rule of #184: a hidden panel holds
 * nothing) or a panel drawing no markdown tree clears it, and a check still
 * running stops.
 *
 * **One thing refreshes it on its own**: the check of #729, at open and at
 * save, writes its answer into the row of the open file, so the row and the
 * «Links» badge give one answer. Nothing else does; Check again reads the
 * folder anew.
 */

export interface FolderLinkReportDeps {
  readonly io: () => Promise<PlatformIO>;
  readonly schema: Schema;
  readonly openDocument: () => OpenDocument | null;
  /** The status line of the panel, which a screen reader is told through. */
  readonly status: HTMLElement | null;
  /** Open `path` by the route a click in the tree takes, through the question about unsaved changes (R-C3). */
  readonly openFile: (path: string, root: TreeRoot) => Promise<void>;
  /** Select `link` in the document on screen and bring it into view, or say it is gone. */
  readonly jump: (link: DocumentLink) => void;
}

export interface FolderLinkReport {
  /** What the panel drew last, or null when it drew no markdown tree or hid. */
  attach: (drawn: DrawnMarkdownTree | null) => void;
  /** The check of #729 answered for the open file. */
  openFileChecked: (path: string | null, result: LinkCheckResult) => void;
  /** The open file was renamed. */
  renamed: (from: string, to: string) => void;
  /** Resolves when the check running, if any, has ended. */
  settled: () => Promise<void>;
}

interface Running {
  read: number;
  total: number;
  stop: boolean;
  readonly done: Promise<void>;
}

export function createFolderLinkReport(deps: FolderLinkReportDeps): FolderLinkReport {
  let drawn: DrawnMarkdownTree | null = null;
  let report: FolderCheck | null = null;
  let running: Running | null = null;
  let expanded = new Set<string>();
  let renamedSince = false;
  /** Counts the checks started, so a check stopped and left behind draws nothing. */
  let generation = 0;

  function tell(text: string): void {
    if (deps.status) deps.status.textContent = text;
  }

  function reset(): void {
    if (running) running.stop = true;
    running = null;
    report = null;
    expanded = new Set();
    renamedSince = false;
    generation += 1;
  }

  function focusButton(text: string): void {
    const target = Array.from(drawn?.slot.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === text,
    );
    target?.focus();
  }

  function draw(): void {
    if (!drawn) return;
    const { slot } = drawn;
    if (running) {
      const r = running;
      slot.replaceChildren(drawRunning(r.read, r.total, () => stop()));
      return;
    }
    if (report) {
      slot.replaceChildren(
        drawReport(
          { check: report, root: drawn.root.path, expanded, renamed: renamedSince },
          {
            onAgain: () => start(),
            onClear: () => {
              reset();
              tell('');
              draw();
              focusButton(FOLDER_CHECK_DOOR);
            },
            onToggle: (key) => {
              if (expanded.has(key)) expanded.delete(key);
              else expanded.add(key);
              draw();
              focusRow(key);
            },
            onJump: (path, link) => void jumpTo(path, link),
          },
        ),
      );
      return;
    }
    slot.replaceChildren(drawDoor(() => start()));
  }

  function focusRow(key: string): void {
    const rows = Array.from(drawn?.slot.querySelectorAll<HTMLElement>('.links-folder-file') ?? []);
    const row = rows.find((r) => r.dataset.key === key);
    row?.focus();
  }

  function stop(): void {
    if (running) running.stop = true;
  }

  function endLine(check: FolderCheck): string {
    if (check.stopped) return `${stoppedLine(check.read, check.total)} ${countsLine(check)}`;
    if (check.bound !== null) return `${countsLine(check)}. ${onlyFirstFilesLine(check.read)}`;
    return countsLine(check);
  }

  function start(): void {
    if (!drawn || running) return;
    const root = drawn.root;
    const files = markdownFilesOf(root.path, drawn.files);
    reset();
    const mine = generation;
    const total = Math.min(files.length, MAX_FOLDER_FILES);
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    running = { read: 0, total, stop: false, done };
    const own = running;
    tell(startedText(total));
    draw();
    void (async () => {
      try {
        const io = await deps.io();
        const check = await checkFolder(files, {
          io,
          schema: deps.schema,
          openDocument: deps.openDocument,
          progress: (read, total) => {
            own.read = read;
            own.total = total;
            if (running === own) updateCount(read, total);
          },
          stopped: () => own.stop,
        });
        if (mine !== generation) return;
        running = null;
        report = check;
        tell(endLine(check));
        draw();
        if (check.stopped) focusButton(FOLDER_CHECK_AGAIN);
      } catch (e) {
        console.error('[agented] the links of the folder could not be checked:', e);
        if (mine === generation) {
          running = null;
          draw();
        }
      } finally {
        finish();
      }
    })();
  }

  /** The count of the line running, changed in place so Stop keeps its focus. */
  function updateCount(read: number, total: number): void {
    const text = drawn?.slot.querySelector('.links-folder-count-text');
    if (text) text.textContent = runningText(read, total);
  }

  /**
   * The open file is already on screen; any other is opened by the route a
   * click in the tree takes, and the link is looked for only when that file is
   * then the one on screen: Cancel at the question leaves everything as it was.
   */
  async function jumpTo(path: string, link: DocumentLink): Promise<void> {
    if (!drawn) return;
    const isOpen = (): boolean => {
      const open = deps.openDocument();
      return open !== null && samePath(open.path, path);
    };
    if (!isOpen()) {
      await deps.openFile(path, drawn.root);
      if (!isOpen()) return;
    }
    deps.jump(link);
  }

  function attach(next: DrawnMarkdownTree | null): void {
    if (next === null || (drawn !== null && !samePath(drawn.root.path, next.root.path))) {
      if (running || report) tell('');
      reset();
    }
    drawn = next;
    draw();
  }

  function openFileChecked(path: string | null, result: LinkCheckResult): void {
    if (path === null || report === null) return;
    const files = report.files.map((f) => (samePath(f.path, path) ? { path: f.path, result } : f));
    report = { ...report, files };
    draw();
  }

  function renamed(from: string, to: string): void {
    if (report === null) return;
    const files = report.files.map((f) => (samePath(f.path, from) ? { ...f, path: to } : f));
    report = { ...report, files };
    if (expanded.has(from)) {
      expanded.delete(from);
      expanded.add(to);
    }
    renamedSince = true;
    draw();
  }

  return {
    attach,
    openFileChecked,
    renamed,
    settled: async () => {
      if (running) await running.done;
    },
  };
}
