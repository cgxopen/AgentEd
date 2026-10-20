/**
 * #636 - one rule says which files are markdown documents: `.md`, `.markdown`
 * and `.mkd`, case folded (owner decisions of 2026-10-20). Before it the
 * launch route took `.md` alone, case and all, in Rust, and dropped every
 * other path without a word, so `NOTES.MD` opened from the file manager gave
 * an empty window while the files panel opened it.
 *
 * **Said first: what the operating system does is not observable here.**
 * Which paths Explorer, Finder or Files hand over, and whether a dialog shows,
 * is the owner pass on the artifact. These rows hold the half the harness can
 * see: the answer of the rule for five names, what the launch route does with
 * each, what the pickers offer, the words of the refusal, and the tie row,
 * which reads the Rust source and fails if it holds a rule of its own again.
 * The Rust rows in `src-tauri/src/file_open.rs` hold the other half: every
 * one of the five names is handed to the page as it was given.
 *
 * The expected answers are written out per row rather than read from
 * `MARKDOWN_EXTENSIONS`: a row taking its cases from the list it checks could
 * not see the list change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fileOpenRs from '../../src-tauri/src/file_open.rs?raw';
import macosWindowsRs from '../../src-tauri/src/macos_windows.rs?raw';
import mainRs from '../../src-tauri/src/main.rs?raw';

const launched = vi.hoisted(() => ({ open: null as ((path: string) => void) | null }));

vi.mock('../platform/detect', () => ({ isTauri: true }));
vi.mock('../platform/file-open', () => ({
  listenForFileOpen: async (open: (path: string) => void) => {
    launched.open = open;
  },
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
vi.mock('@tauri-apps/api/path', () => ({ resolveResource: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { isMarkdownPath } from '../platform/paths';
import { TauriIO } from '../platform/tauri';
import { WebIO } from '../platform/web';
import type { ErrorReporter } from './error-reporter';
import { setupFileAssociation } from './file-association';
import { notMarkdownMessage, OPEN_FAILED_TITLE } from './open-failure';

/** The five names of #636 and whether each is a markdown document. */
const NAMES = [
  { name: 'notes.md', markdown: true },
  { name: 'NOTES.MD', markdown: true },
  { name: 'notes.markdown', markdown: true },
  { name: 'notes.mkd', markdown: true },
  { name: 'notes.txt', markdown: false },
] as const;

describe('the rule (#636)', () => {
  it.each(NAMES)('$name: markdown $markdown', ({ name, markdown }) => {
    expect(isMarkdownPath(`C:\\Users\\vasil\\Downloads\\${name}`)).toBe(markdown);
    expect(isMarkdownPath(`/home/cata/notes/${name}`)).toBe(markdown);
  });

  it('asks the end of the name, not a part of it', () => {
    expect(isMarkdownPath('/d/notes.md.txt')).toBe(false);
    expect(isMarkdownPath('/d/notes.mkdx')).toBe(false);
    expect(isMarkdownPath('/d/md')).toBe(false);
  });
});

describe('the launch route: every platform, command line and file manager (#636)', () => {
  const openFilePath = vi.fn(async (_path: string) => {});
  const dialog = vi.fn(async () => {});
  const reporter = { silent: vi.fn(), toast: vi.fn(), dialog } as unknown as ErrorReporter;

  beforeEach(() => {
    vi.clearAllMocks();
    setupFileAssociation(openFilePath, reporter);
  });

  /** Hand the page a path, as the process does, and let it settle. */
  async function launch(path: string): Promise<void> {
    await Promise.resolve();
    if (!launched.open) throw new Error('setupFileAssociation installed no listener');
    launched.open(path);
    await Promise.resolve();
  }

  it.each(NAMES)('$name: opened $markdown, refused otherwise', async ({ name, markdown }) => {
    const path = `/home/cata/notes/${name}`;
    await launch(path);
    if (markdown) {
      expect(openFilePath).toHaveBeenCalledWith(path);
      expect(dialog).not.toHaveBeenCalled();
    } else {
      expect(openFilePath).not.toHaveBeenCalled();
      expect(dialog).toHaveBeenCalledWith(
        notMarkdownMessage(path),
        null,
        OPEN_FAILED_TITLE,
        'omit',
      );
    }
  });
});

describe('the refusal says why, in the shape of the other refusals of an open (#636)', () => {
  it('names the cause, that nothing changed, the rule and the path', () => {
    expect(OPEN_FAILED_TITLE).toBe('This file could not be opened');
    expect(notMarkdownMessage('C:\\Users\\vasil\\Downloads\\notes.txt')).toBe(
      'This file is not a markdown document, so it has not been opened. ' +
        'Nothing has changed on disk.\n\n' +
        'AgentEd opens files whose names end in .md, .markdown or .mkd.\n\n' +
        'C:\\Users\\vasil\\Downloads\\notes.txt',
    );
  });
});

describe('the Open pickers offer the rule and txt (#636)', () => {
  afterEach(() => {
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });

  it('the desktop picker: md, markdown, mkd and txt', async () => {
    await new TauriIO().openFile();
    const options = vi.mocked(dialogOpen).mock.calls[0]?.[0];
    expect(options?.filters).toEqual([
      { name: 'AgentEd', extensions: ['md', 'markdown', 'mkd', 'txt'] },
    ]);
  });

  it('the web picker: .md, .markdown and .mkd as markdown, .txt as plain text', async () => {
    const picker = vi.fn(async () => {
      throw new DOMException('closed', 'AbortError');
    });
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = picker;
    expect(await new WebIO().openFile()).toBeNull();
    expect(picker).toHaveBeenCalledWith({
      types: [
        {
          description: 'AgentEd files',
          accept: { 'text/markdown': ['.md', '.markdown', '.mkd'], 'text/plain': ['.txt'] },
        },
      ],
    });
  });
});

/** The source before its test module: what ships. */
function shipped(source: string): string {
  const tests = source.indexOf('#[cfg(test)]\nmod tests');
  return tests < 0 ? source : source.slice(0, tests);
}

describe('the tie: the Rust side holds no rule of its own (#636)', () => {
  // The Rust rows in `file_open.rs` assert each of the five names is handed
  // over; this row asserts nothing on the launch route decides by extension
  // before the page does. An extension filter added there again, the way
  // `is_markdown` took `.md` alone until #636, reddens it.
  it.each([
    { file: 'file_open.rs', source: fileOpenRs },
    { file: 'macos_windows.rs', source: macosWindowsRs },
    { file: 'main.rs', source: mainRs },
  ])('$file decides nothing by the end of a name', ({ source }) => {
    const code = shipped(source)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/ends_with\(|\.extension\(|"\.?(md|markdown|mkd|txt)"/);
  });

  it('the launch route reaches the page through the functions the Rust rows test', () => {
    expect(shipped(mainRs)).toContain('file_open::extract_file_arg(&args)');
    expect(shipped(mainRs)).toContain('file_open::file_paths_from_urls(&urls)');
  });
});
