import { clearImages } from '../editor/image-registry';
import { splitFrontmatter } from '../formats/frontmatter';
import { detectExternalChange, loadDocument, saveDocument } from '../formats/index';
import { getPlatformIO } from '../platform/index';
import { basename, dirname } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { saveLastOpenedFolder } from '../preferences';
import { getTemplate, type TemplateId } from '../templates/index';
import { shouldShowFrontmatterPanel } from '../ui/frontmatter-panel';
import { showToast } from '../ui/toast';
import { applyBundle, buildBundle } from './bundle';
import type { AppContext } from './context';
import { createDiscardGate } from './discard-gate';
import { askAboutExternalChange } from './external-change-prompt';
import { createRequestSaveAs } from './save-as-flow';

export interface DocumentActions {
  handleNew(): Promise<void>;
  handleNewFromTemplate(templateId: TemplateId): Promise<void>;
  handleOpen(): Promise<void>;
  handleSave(): Promise<void>;
  handleSaveAs(): Promise<void>;
  handleClose(): Promise<void>;
  openFilePath(path: string): Promise<void>;
  requestSaveAs(): Promise<string | null>;
  /**
   * Run the unsaved-changes gate for a window close / app quit. Resolves
   * `true` when the window may close (nothing unsaved, saved on request,
   * or discarded on request) and `false` when the user cancelled.
   */
  confirmWindowClose(): Promise<boolean>;
}

export function createDocumentActions(ctx: AppContext): DocumentActions {
  const requestSaveAs = createRequestSaveAs(ctx);

  function clearDocumentForReplacement(): void {
    ctx.state.resetDocument();
    ctx.setFilename(null);
    ctx.editor.commands.clearContent();
    ctx.statusbar.refresh();
    ctx.frontmatterPanel.refresh();
    ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
    clearImages();
    ctx.state.setModified(false);
  }

  async function loadBundleFromPath(path: string, errorLabel: string): Promise<void> {
    const io = await getPlatformIO();
    try {
      const loaded = await loadDocument(path, io);
      await applyBundle(loaded, path, ctx, io);

      const folder = dirname(path);
      if (folder.length > 0) saveLastOpenedFolder(folder);

      await ctx.refreshSidebar();
      ctx.updateCloseEnabled();
    } catch (e) {
      await ctx.reporter.dialog(errorLabel, e);
    }
  }

  /**
   * Tell the user the document was saved but its images were not. Modal
   * rather than a toast: the file on disk now references images that do
   * not exist next to it, which is not something to let scroll past.
   */
  async function reportAssetsFailure(error: unknown): Promise<void> {
    const needsFolderAccess = error instanceof Error && error.message.includes('NO_DIR_HANDLE');
    const remedy = needsFolderAccess
      ? 'Web mode: use Save As to grant folder access, then save again.'
      : 'The images are still open in this document — saving again will retry them.';
    await ctx.reporter.dialog(
      'The document was saved, but its images could not be written to the ' +
        `assets folder next to it.\n\n${remedy}`,
      error,
      'Images not saved',
    );
  }

  /**
   * The R-C14 gate, run before every write to a path the editor already
   * knows: is the file still the one AgentEd last read or wrote?
   *
   * Returns `'write'` when the save may go ahead — either nothing
   * changed, or the user chose to overwrite, or they chose a different
   * destination and the picker gave one. Returns `'stop'` when it may
   * not: the document was reloaded from disk instead, or the user
   * backed out. Nothing is written on that branch, and the document
   * stays modified, which is the accurate statement (R-C3).
   */
  async function resolveExternalChange(io: PlatformIO, path: string): Promise<'write' | 'stop'> {
    const change = await detectExternalChange(path, ctx.state.knownDiskText, io);
    if (change.kind === 'none') return 'write';

    switch (await askAboutExternalChange(basename(path), change)) {
      case 'overwrite':
        return 'write';
      case 'save-as':
        // The picker moves the document to a new path and clears the
        // baseline with it, so the write below lands there instead.
        return (await requestSaveAs()) ? 'write' : 'stop';
      case 'reload':
        await loadBundleFromPath(path, `Failed to reload document: ${path}`);
        return 'stop';
      case 'cancel':
        return 'stop';
    }
  }

  /**
   * Write the current document to disk exactly as the user wrote it —
   * body, plus the frontmatter block only if the document already has
   * one. Nothing is ever injected on save.
   */
  async function persistBundle(): Promise<void> {
    const io = await getPlatformIO();

    // Before the bundle is built, not after: the answer to the question
    // may move the document to a different file, and the bundle carries
    // the path it will be written to.
    const target = ctx.state.filePath;
    if (target !== null && (await resolveExternalChange(io, target)) === 'stop') return;

    const bundle = buildBundle(ctx.state, ctx.getMarkdown);

    let result: Awaited<ReturnType<typeof saveDocument>>;
    try {
      result = await saveDocument(bundle, io);
    } catch (e) {
      if (e instanceof Error && e.message.includes('NO_DIR_HANDLE')) {
        showToast(
          'Web mode: please use Save As to grant folder access for this document type.',
          'warn',
        );
        return;
      }
      throw e;
    }

    ctx.state.isFirstSave = false;
    // The `.md` is on disk and this is exactly what went into it, so it
    // is what the next save compares against (R-C14). Recorded before
    // the images branch below on purpose: a save whose images failed
    // still wrote the document, and the retry it invites must not find
    // AgentEd accusing itself of its own write.
    ctx.state.knownDiskText = result.writtenText;

    if (result.assetsError) {
      // The .md is on disk; its images are not. The save stands — we
      // never un-write a document — but the document stays **modified**,
      // because that is the accurate statement: not all of it reached
      // the disk. A clipboard image exists only in the in-memory
      // registry, so clearing the flag here would leave nothing between
      // the user and closing the app on top of it. Keeping it on puts
      // the existing unsaved-changes gate back in front of that loss
      // (R-C3/Q4) and gives the retry the modal promises somewhere to
      // land: Ctrl+S tries again, and discarding stays a knowing act.
      ctx.state.setModified(true);
      await reportAssetsFailure(result.assetsError);
    } else {
      ctx.state.setModified(false);
    }

    if (ctx.state.filePath) {
      const folder = dirname(ctx.state.filePath);
      if (folder.length > 0) saveLastOpenedFolder(folder);
    }
  }

  async function handleSave(): Promise<void> {
    if (ctx.state.isSaving) return;
    // Fresh document without a path → delegate. Don't claim `isSaving`
    // here, otherwise handleSaveAs bails out on its own guard and the
    // user sees the picker never appear. handleSaveAs manages the flag
    // for that branch.
    if (!ctx.state.filePath) {
      await handleSaveAs();
      return;
    }
    ctx.state.isSaving = true;
    try {
      await persistBundle();
      await ctx.refreshSidebar();
    } finally {
      ctx.state.isSaving = false;
    }
  }

  async function handleSaveAs(): Promise<void> {
    if (ctx.state.isSaving) return;
    ctx.state.isSaving = true;
    try {
      const path = await requestSaveAs();
      if (!path) return;
      await persistBundle();
      await ctx.refreshSidebar();
    } finally {
      ctx.state.isSaving = false;
    }
  }

  const discardCurrentDocument = createDiscardGate(ctx, handleSave);

  async function handleNew(): Promise<void> {
    if (ctx.state.isSaving) return;
    if (!(await discardCurrentDocument('new'))) return;

    clearDocumentForReplacement();
    ctx.sidebar.hide();
  }

  /**
   * Seed a fresh document from one of the built-in templates. Routes
   * through the same safety gate as `handleNew`, then splits the seed
   * into frontmatter + body and pushes both into the editor + state.
   * The document is unsaved — Save / Save As writes it to disk.
   */
  async function handleNewFromTemplate(templateId: TemplateId): Promise<void> {
    if (ctx.state.isSaving) return;

    const template = getTemplate(templateId);
    if (!template) {
      showToast(`Unknown template: ${templateId}`, 'warn');
      return;
    }

    if (!(await discardCurrentDocument('new'))) return;

    clearDocumentForReplacement();
    ctx.sidebar.hide();

    const { raw, body } = splitFrontmatter(template.body);
    ctx.state.frontmatter = raw;

    ctx.setMarkdown(body);
    ctx.frontmatterPanel.refresh();
    ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
    ctx.statusbar.refresh();
    ctx.state.setModified(true);
  }

  async function handleClose(): Promise<void> {
    if (ctx.state.isSaving) return;
    if (!(await discardCurrentDocument('close'))) return;

    clearDocumentForReplacement();
    ctx.sidebar.hide();
  }

  /**
   * Gate for the window-close / quit path. A save already in flight blocks
   * the close rather than racing it: the write finishes and the user closes
   * again, instead of the app exiting mid-write.
   */
  async function confirmWindowClose(): Promise<boolean> {
    // The close guard refuses this case first and tells the user why; this
    // is the backstop that keeps the invariant true for any other caller.
    if (ctx.state.isSaving) return false;
    return await discardCurrentDocument('window-close');
  }

  async function handleOpen(): Promise<void> {
    if (!(await discardCurrentDocument('open'))) return;

    const io = await getPlatformIO();
    let result: Awaited<ReturnType<typeof io.openFile>>;
    try {
      result = await io.openFile();
    } catch (e) {
      await ctx.reporter.dialog('Failed to open file', e);
      return;
    }
    if (!result) return;

    await loadBundleFromPath(result.path, `Failed to open document: ${result.path}`);
  }

  async function openFilePath(path: string): Promise<void> {
    if (!(await discardCurrentDocument('open'))) return;
    await loadBundleFromPath(path, `Failed to open file: ${path}`);
  }

  return {
    handleNew,
    handleNewFromTemplate,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleClose,
    openFilePath,
    requestSaveAs,
    confirmWindowClose,
  };
}
