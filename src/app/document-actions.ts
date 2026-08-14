import { clearImages } from '../editor/image-registry';
import { splitFrontmatter } from '../formats/frontmatter';
import { loadDocument, saveDocument } from '../formats/index';
import { getPlatformIO } from '../platform/index';
import { dirname } from '../platform/paths';
import { saveLastOpenedFolder } from '../preferences';
import { getTemplate, type TemplateId } from '../templates/index';
import { shouldShowFrontmatterPanel } from '../ui/frontmatter-panel';
import { showToast } from '../ui/toast';
import { applyBundle, buildBundle } from './bundle';
import type { AppContext } from './context';
import { createDiscardGate } from './discard-gate';
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
      const bundle = await loadDocument(path, io);
      await applyBundle(bundle, path, ctx, io);

      const folder = dirname(path);
      if (folder.length > 0) saveLastOpenedFolder(folder);

      await ctx.refreshSidebar();
      ctx.updateCloseEnabled();
    } catch (e) {
      await ctx.reporter.dialog(errorLabel, e);
    }
  }

  /**
   * Write the current document to disk exactly as the user wrote it —
   * body, plus the frontmatter block only if the document already has
   * one. Nothing is ever injected on save.
   */
  async function persistBundle(): Promise<void> {
    const io = await getPlatformIO();
    const bundle = buildBundle(ctx.state, ctx.getMarkdown);

    try {
      await saveDocument(bundle, io);
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
    ctx.state.setModified(false);

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
  };
}
