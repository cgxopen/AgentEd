import { detectContextCluster } from '../cluster/detector';
import { ContextCluster } from '../cluster/types';
import { clearImages, getAllImages, registerForDisplay } from '../editor/image-registry';
import type { DocumentBundle, DocumentImage } from '../formats/types';
import { basename, dirname } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { detectProfileForBundle } from '../profiles/detect-bundle';
import { shouldShowFrontmatterPanel } from '../ui/frontmatter-panel';
import type { AppContext } from './context';
import { prepareMarkdownForDisplay } from './image-loader';
import type { AppState } from './state';

export function registerBundleImages(images: DocumentImage[], docPath: string): void {
  const docDir = dirname(docPath);
  for (const img of images) {
    registerForDisplay(img.relativePath, img.data, img.filename, docDir);
  }
}

/** Build a bundle from the current editor state + preserved frontmatter/archive. */
export function buildBundle(state: AppState, getMarkdown: () => string): DocumentBundle {
  return {
    frontmatterRaw: state.frontmatter,
    markdownBody: getMarkdown(),
    images: getAllImages(),
    archiveEntries: state.archiveEntries,
    rootPath: state.filePath ?? 'untitled.md',
    meta: state.meta,
    docFolder: state.docFolder,
    layout: state.layout,
  };
}

/**
 * Load a bundle into the editor and sync all derived state. `io` is passed
 * explicitly because callers already have a resolved PlatformIO to hand in;
 * the other dependencies live on ctx.
 */
export async function applyBundle(
  bundle: DocumentBundle,
  path: string,
  ctx: AppContext,
  io: PlatformIO,
  onProfileApplied: () => void,
): Promise<void> {
  ctx.state.filePath = path;
  ctx.state.meta = bundle.meta;
  ctx.state.frontmatter = bundle.frontmatterRaw;
  ctx.state.archiveEntries = bundle.archiveEntries;
  ctx.state.isFirstSave = false;
  ctx.state.profile = await detectProfileForBundle(bundle, io);
  ctx.state.profileOverridden = false;
  ctx.state.docFolder = bundle.docFolder;
  ctx.state.layout = bundle.layout;

  clearImages();
  registerBundleImages(bundle.images, path);

  ctx.setFilename(basename(path), path);

  const displayBody = await prepareMarkdownForDisplay(bundle, io);
  ctx.setMarkdown(displayBody);

  ctx.statusbar.refresh();
  ctx.frontmatterPanel.refresh();
  ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
  ctx.profileIndicator.refresh();
  ctx.state.setModified(false);
  onProfileApplied();

  // Cluster detection runs after the document is rendered so the user
  // sees content immediately; the popover appears once results land.
  scheduleClusterDetection(path, ctx, io);
}

/**
 * Kick off a cluster scan and commit the result to state when it
 * resolves. The scan generation guards against rapid Open succession:
 * a stale resolution finds a bumped generation and bails silently.
 *
 * Errors are logged and produce an empty cluster — the indicator just
 * stays hidden, no toast or banner per ADR-031 §D6 ("graceful disabled").
 */
export function scheduleClusterDetection(path: string, ctx: AppContext, io: PlatformIO): void {
  const myGeneration = ctx.state.beginClusterScan();
  void detectContextCluster(path, io)
    .then((cluster) => {
      if (myGeneration !== ctx.state.clusterScanGeneration) return;
      ctx.state.setCluster(cluster);
    })
    .catch((e) => {
      console.warn('cluster detection failed:', e);
      if (myGeneration !== ctx.state.clusterScanGeneration) return;
      ctx.state.setCluster(ContextCluster.empty(path));
    });
}
