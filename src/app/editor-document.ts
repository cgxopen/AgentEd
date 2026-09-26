import { clearImages, getAllImages } from '../editor/image-registry';
import type { LoadResult } from '../formats/index';
import type { MarkdownDocument } from '../formats/types';
import { basename } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { shouldShowFrontmatterPanel } from '../ui/frontmatter-panel';
import type { AppContext } from './context';
import { prepareMarkdownForDisplay } from './image-loader';
import type { AppState } from './state';

/** Build a document from the current editor state + preserved frontmatter. */
export function buildDocument(state: AppState, getMarkdown: () => string): MarkdownDocument {
  return {
    frontmatterRaw: state.frontmatter,
    markdownBody: getMarkdown(),
    images: getAllImages(),
    rootPath: state.filePath ?? 'untitled.md',
    byteOrderMark: state.byteOrderMark,
    lineConventions: state.lineConventions,
  };
}

/**
 * Load a document into the editor and sync all derived state. `io` is passed
 * explicitly because callers already have a resolved PlatformIO to hand in;
 * the other dependencies live on ctx.
 *
 * The whole `LoadResult` is taken rather than just its document because the
 * text that was on disk is recorded here, next to the path it belongs to:
 * this is the moment AgentEd learns what the file contains, and every
 * later save compares against it (R-C14).
 */
export async function applyLoadedDocument(
  loaded: LoadResult,
  path: string,
  ctx: AppContext,
  io: PlatformIO,
): Promise<void> {
  const document = loaded.document;
  ctx.state.filePath = path;
  ctx.state.knownDiskText = loaded.diskText;
  // The file's own line conventions, read on open and re-applied to
  // everything AgentEd writes to it afterwards (#79).
  ctx.state.lineConventions = document.lineConventions;
  // The file's own byte order mark, read on open and put back on every
  // save afterwards (#259) - the same shape, one property over.
  ctx.state.byteOrderMark = document.byteOrderMark;
  ctx.state.frontmatter = document.frontmatterRaw;
  ctx.state.isFirstSave = false;

  clearImages();

  ctx.setFilename(basename(path), path);

  const displayBody = await prepareMarkdownForDisplay(document, io);
  ctx.setMarkdown(displayBody);

  ctx.statusbar.refresh();
  ctx.frontmatterPanel.refresh();
  ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
  // What was just read is what is on disk: the snapshot the modified rule
  // compares against from here on (#441).
  ctx.state.markSaved(ctx.state.frontmatter);
}
