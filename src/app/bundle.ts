import { clearImages, getAllImages } from '../editor/image-registry';
import type { LoadResult } from '../formats/index';
import type { DocumentBundle } from '../formats/types';
import { basename } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { shouldShowFrontmatterPanel } from '../ui/frontmatter-panel';
import type { AppContext } from './context';
import { prepareMarkdownForDisplay } from './image-loader';
import type { AppState } from './state';

/** Build a bundle from the current editor state + preserved frontmatter. */
export function buildBundle(state: AppState, getMarkdown: () => string): DocumentBundle {
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
 * Load a bundle into the editor and sync all derived state. `io` is passed
 * explicitly because callers already have a resolved PlatformIO to hand in;
 * the other dependencies live on ctx.
 *
 * The whole `LoadResult` is taken rather than just its bundle because the
 * text that was on disk is recorded here, next to the path it belongs to:
 * this is the moment AgentEd learns what the file contains, and every
 * later save compares against it (R-C14).
 */
export async function applyBundle(
  loaded: LoadResult,
  path: string,
  ctx: AppContext,
  io: PlatformIO,
): Promise<void> {
  const bundle = loaded.bundle;
  ctx.state.filePath = path;
  ctx.state.knownDiskText = loaded.diskText;
  // The file's own line conventions, read on open and re-applied to
  // everything AgentEd writes to it afterwards (#79).
  ctx.state.lineConventions = bundle.lineConventions;
  // The file's own byte order mark, read on open and put back on every
  // save afterwards (#259) - the same shape, one property over.
  ctx.state.byteOrderMark = bundle.byteOrderMark;
  ctx.state.frontmatter = bundle.frontmatterRaw;
  ctx.state.isFirstSave = false;

  clearImages();

  ctx.setFilename(basename(path), path);

  const displayBody = await prepareMarkdownForDisplay(bundle, io);
  ctx.setMarkdown(displayBody);

  ctx.statusbar.refresh();
  ctx.frontmatterPanel.refresh();
  ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
  ctx.state.setModified(false);
}
