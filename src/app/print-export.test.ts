/**
 * File, Print and File, Export to PDF (#725), driven through the real
 * metadata panel: the block opened while the page is printed or exported and
 * given back its state after, with no change to the text, the unsaved marker
 * or the field. The platform calls are stubbed; what the dialog and the file
 * look like is verified on the pull request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({
  printDocument: vi.fn(),
  canExportPdf: vi.fn(() => true),
  exportPdf: vi.fn(async () => 'A4'),
  pickSavePath: vi.fn(async (): Promise<string | null> => '/docs/notes.pdf'),
}));

vi.mock('../platform', () => ({
  printDocument: platform.printDocument,
  canExportPdf: platform.canExportPdf,
  exportPdf: platform.exportPdf,
  getPlatformIO: async () => ({ pickSavePath: platform.pickSavePath }),
}));

import { setupFrontmatterPanel } from '../ui/frontmatter-panel';
import type { ErrorReporter } from './error-reporter';
import {
  EXPORT_FAILED_TITLE,
  exportWithMetadataOpen,
  printWithMetadataOpen,
  proposedPdfPath,
} from './print-export';
import { AppState } from './state';

const YAML = 'name: print-725\ndescription: A fixed document.';

let state: AppState;
let details: HTMLDetailsElement;
let field: HTMLTextAreaElement;
let inputs: number;
const dialog = vi.fn(async (_message: string, _error: unknown, _title?: string) => {});
const reporter = { silent: vi.fn(), toast: vi.fn(), dialog } as unknown as ErrorReporter;

function deps() {
  return {
    panel: setupFrontmatterPanel(state),
    reporter,
    filePath: () => state.filePath,
  };
}

/** What a print or an export must leave as it was. */
function untouched(): void {
  expect(details.open).toBe(false);
  expect(field.value).toBe(YAML);
  expect(field.style.height).toBe('');
  expect(state.frontmatter).toBe(YAML);
  expect(state.modified).toBe(false);
  expect(inputs).toBe(0);
}

beforeEach(() => {
  document.body.innerHTML =
    '<details id="frontmatter-panel"><summary>Metadata (YAML)</summary><textarea id="frontmatter-input"></textarea></details>';
  details = document.getElementById('frontmatter-panel') as HTMLDetailsElement;
  field = document.getElementById('frontmatter-input') as HTMLTextAreaElement;
  state = new AppState();
  state.frontmatter = YAML;
  state.markSaved(YAML);
  field.value = YAML;
  inputs = 0;
  field.addEventListener('input', () => inputs++);
  for (const f of [platform.printDocument, platform.exportPdf, platform.pickSavePath, dialog])
    f.mockClear();
  platform.canExportPdf.mockReturnValue(true);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('File, Print (#725)', () => {
  it('prints with the metadata block open and its field sized to its text', () => {
    let openWhenPrinted: boolean | null = null;
    let heightWhenPrinted: string | null = null;
    platform.printDocument.mockImplementationOnce(() => {
      openWhenPrinted = details.open;
      heightWhenPrinted = field.style.height;
    });
    printWithMetadataOpen(deps());
    expect(platform.printDocument).toHaveBeenCalledTimes(1);
    expect(openWhenPrinted).toBe(true);
    // happy-dom lays nothing out, so the height is `0px` here; what is
    // asserted is that the field is given the height of its text, a pixel value.
    expect(heightWhenPrinted).toMatch(/^\d+px$/);
  });

  it('gives the block back on afterprint, where the engine fires it', () => {
    printWithMetadataOpen(deps());
    expect(details.open).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    untouched();
  });

  it('gives the block back at the first key or pointer press after the dialog, where afterprint never comes', () => {
    printWithMetadataOpen(deps());
    expect(details.open).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    untouched();
    printWithMetadataOpen(deps());
    document.dispatchEvent(new Event('pointerdown'));
    untouched();
  });

  it('gives a block that was open back open', () => {
    details.open = true;
    printWithMetadataOpen(deps());
    window.dispatchEvent(new Event('afterprint'));
    expect(details.open).toBe(true);
    expect(state.modified).toBe(false);
  });

  it('a print that fails is told in a dialog, and the block is given back', () => {
    platform.printDocument.mockImplementationOnce(() => {
      throw new Error('no printing here');
    });
    printWithMetadataOpen(deps());
    expect(dialog).toHaveBeenCalledTimes(1);
    untouched();
  });
});

describe('File, Export to PDF (#725)', () => {
  it('asks for a path proposed from the document, then writes there with the block open', async () => {
    state.filePath = '/docs/notes.md';
    let openWhenWritten: boolean | null = null;
    platform.exportPdf.mockImplementationOnce(async () => {
      openWhenWritten = details.open;
      return 'A4';
    });
    await exportWithMetadataOpen(deps());
    expect(platform.pickSavePath).toHaveBeenCalledWith('PDF', ['pdf'], '/docs/notes.pdf');
    expect(platform.exportPdf).toHaveBeenCalledWith('/docs/notes.pdf');
    expect(openWhenWritten).toBe(true);
    untouched();
  });

  it('a cancelled save dialog writes nothing and opens nothing', async () => {
    platform.pickSavePath.mockResolvedValueOnce(null);
    await exportWithMetadataOpen(deps());
    expect(platform.exportPdf).not.toHaveBeenCalled();
    untouched();
  });

  it('a failed export is told in a dialog, never the console alone, and the block is given back', async () => {
    platform.exportPdf.mockRejectedValueOnce('The PDF could not be written.');
    await exportWithMetadataOpen(deps());
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0]?.[2]).toBe(EXPORT_FAILED_TITLE);
    untouched();
  });

  it('where the build cannot export, the web build, the entry prints instead', async () => {
    platform.canExportPdf.mockReturnValue(false);
    await exportWithMetadataOpen(deps());
    expect(platform.pickSavePath).not.toHaveBeenCalled();
    expect(platform.printDocument).toHaveBeenCalledTimes(1);
  });
});

describe('the name proposed for the PDF (#725)', () => {
  it.each([
    ['/docs/notes.md', '/docs/notes.pdf'],
    ['C:\\Users\\me\\AGENTS.md', 'C:\\Users\\me\\AGENTS.pdf'],
    ['/docs/read.me.markdown', '/docs/read.me.pdf'],
    [null, 'Untitled.pdf'],
  ])('%s gives %s', (path, proposed) => {
    expect(proposedPdfPath(path)).toBe(proposed);
  });
});
