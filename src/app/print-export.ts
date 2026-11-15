import { canExportPdf, exportPdf, getPlatformIO, printDocument } from '../platform';
import { basename, stripExtension } from '../platform/paths';
import type { FrontmatterPanel } from '../ui/frontmatter-panel';
import type { ErrorReporter } from './error-reporter';

/** The dialog title when an export fails (#725). */
export const EXPORT_FAILED_TITLE = 'PDF not exported';

/** The words of that dialog; the reason follows them. */
export const EXPORT_FAILED_MESSAGE = 'AgentEd could not write the PDF.';

/**
 * The name proposed in the save dialog of Export to PDF: the document name
 * with `.pdf`, in the folder of the document, or `Untitled.pdf` for a document
 * with no file yet. Only the name is replaced, so the folder keeps the
 * separators the system wrote it with.
 */
export function proposedPdfPath(filePath: string | null): string {
  if (filePath === null) return 'Untitled.pdf';
  const name = basename(filePath);
  return `${filePath.slice(0, filePath.length - name.length)}${stripExtension(name)}.pdf`;
}

interface PrintExportDeps {
  readonly panel: FrontmatterPanel;
  readonly reporter: ErrorReporter;
  readonly filePath: () => string | null;
  /** The window the print dialog belongs to; a test passes its own. */
  readonly target?: Window;
}

/**
 * File, Print (#725): the print dialog of the system, with the metadata block
 * open. The block is given back its state at the first of two signs that the
 * dialog is done: `afterprint`, where it fires (Windows, macOS), or the first
 * pointer press or key press in the document after the call, where it does
 * not (Linux, measured on the step zero). The call itself is not waited for:
 * on Windows it returns when the dialog closes, elsewhere at once.
 */
export function printWithMetadataOpen(deps: PrintExportDeps): void {
  const target = deps.target ?? window;
  const restore = deps.panel.openForPrint();
  let done = false;
  const signals: ReadonlyArray<readonly [EventTarget, string]> = [
    [target, 'afterprint'],
    [target.document, 'pointerdown'],
    [target.document, 'keydown'],
  ];
  const finish = (): void => {
    if (done) return;
    done = true;
    for (const [where, name] of signals) where.removeEventListener(name, finish, true);
    restore();
  };
  for (const [where, name] of signals) where.addEventListener(name, finish, true);
  try {
    printDocument();
  } catch (e) {
    finish();
    void deps.reporter.dialog('AgentEd could not open the print dialog.', e, 'Not printed');
  }
}

/**
 * File, Export to PDF (#725): a save dialog of ours, then the PDF written by
 * the process to the path chosen, with the metadata block open while it is
 * written and given back after. Where the build cannot export, the web build,
 * the entry prints instead. A failure is told in a dialog.
 */
export async function exportWithMetadataOpen(deps: PrintExportDeps): Promise<void> {
  if (!canExportPdf()) {
    printWithMetadataOpen(deps);
    return;
  }
  const io = await getPlatformIO();
  const path = await io.pickSavePath('PDF', ['pdf'], proposedPdfPath(deps.filePath()));
  if (path === null) return;
  const restore = deps.panel.openForPrint();
  try {
    await exportPdf(path);
  } catch (e) {
    await deps.reporter.dialog(EXPORT_FAILED_MESSAGE, e, EXPORT_FAILED_TITLE);
  } finally {
    restore();
  }
}
