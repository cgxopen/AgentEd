import { clearImages } from '../editor/image-registry';
import { ensureFrontmatterForProfile, splitFrontmatter } from '../formats/frontmatter';
import { loadDocument, saveDocument } from '../formats/index';
import { getPlatformIO } from '../platform/index';
import { dirname } from '../platform/paths';
import { saveLastOpenedFolder } from '../preferences';
import { detectProfileForBundle } from '../profiles/detect-bundle';
import { getProfile } from '../profiles/index';
import type { ProfileId } from '../profiles/types';
import { shouldShowFrontmatterPanel } from '../ui/frontmatter-panel';
import { showToast } from '../ui/toast';
import { applyBundle, buildBundle } from './bundle';
import type { AppContext } from './context';
import { createDiscardGate } from './discard-gate';
import { createRequestSaveAs } from './save-as-flow';

export interface DocumentActions {
  handleNew(): Promise<void>;
  handleNewFromTemplate(profileId: ProfileId): Promise<void>;
  handleOpen(): Promise<void>;
  handleSave(): Promise<void>;
  handleSaveAs(): Promise<void>;
  handleClose(): Promise<void>;
  openFilePath(path: string): Promise<void>;
  requestSaveAs(): Promise<string | null>;
}

export function createDocumentActions(ctx: AppContext): DocumentActions {
  const requestSaveAs = createRequestSaveAs(ctx);

  function onProfileApplied(): void {
    ctx.profileManager.triggerValidation();
  }

  function clearDocumentForReplacement(): void {
    ctx.state.resetDocument();
    ctx.setFilename(null);
    ctx.editor.commands.clearContent();
    ctx.statusbar.refresh();
    ctx.frontmatterPanel.refresh();
    ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
    ctx.profileIndicator.refresh();
    clearImages();
    ctx.state.setModified(false);
  }

  async function loadBundleFromPath(path: string, errorLabel: string): Promise<void> {
    const io = await getPlatformIO();
    try {
      const bundle = await loadDocument(path, io);
      await applyBundle(bundle, path, ctx, io, onProfileApplied);

      const folder = dirname(path);
      if (folder.length > 0) saveLastOpenedFolder(folder);

      await ctx.refreshSidebar();
      ctx.updateCloseEnabled();
    } catch (e) {
      await ctx.reporter.dialog(errorLabel, e);
    }
  }

  async function persistBundle(): Promise<void> {
    const io = await getPlatformIO();
    let bundle = buildBundle(ctx.state, ctx.getMarkdown);

    // Re-detect profile BEFORE frontmatter injection so a Save As that
    // changes the filename (e.g. plain → SKILL.md) picks the right
    // skill profile and injects the matching defaults on this same
    // save, not on the next one. Skip when the user pinned a profile
    // via the statusbar override.
    if (!ctx.state.profileOverridden) {
      const detected = await detectProfileForBundle(bundle, io);
      if (detected !== ctx.state.profile) {
        ctx.state.profile = detected;
        ctx.profileIndicator.refresh();
        ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
      }
    }

    const profile = getProfile(ctx.state.profile);
    bundle = ensureFrontmatterForProfile(bundle, profile);
    if (bundle.frontmatterRaw !== ctx.state.frontmatter) {
      ctx.state.frontmatter = bundle.frontmatterRaw;
      // Keep the editable panel in sync with the injected YAML so the
      // user sees (and can edit) the just-generated frontmatter.
      ctx.frontmatterPanel.refresh();
      ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
      showToast('Frontmatter added — please update name and description', 'info');
    }

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
      ctx.profileManager.triggerValidation();
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
      // Re-run validation after save — the just-injected frontmatter
      // satisfies frontmatter rules, but the panel won't reflect that
      // until something re-triggers. handleSave already does this at
      // the end; handleSaveAs needs it too.
      ctx.profileManager.triggerValidation();
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
    onProfileApplied();
  }

  /**
   * Seed a fresh document from one of the built-in templates. Routes
   * through the same safety gate as `handleNew`, then reads the
   * profile's bundled markdown, splits it into frontmatter + body,
   * pins the profile, and pushes both into the editor + state. The
   * document is unsaved — Save / Save As writes it to disk.
   */
  async function handleNewFromTemplate(profileId: ProfileId): Promise<void> {
    if (ctx.state.isSaving) return;
    if (!(await discardCurrentDocument('new'))) return;

    clearDocumentForReplacement();
    ctx.sidebar.hide();

    const profile = getProfile(profileId);
    const template = profile.getTemplate();
    const { raw, body } = splitFrontmatter(template);
    ctx.state.frontmatter = raw;
    ctx.state.profile = profileId;
    // Templates seed the *intent* — they're not the result of
    // auto-detection. Mark as overridden so a quick first save
    // doesn't redirect the profile back to plain just because the
    // file isn't on disk yet.
    ctx.state.profileOverridden = true;

    ctx.setMarkdown(body);
    ctx.frontmatterPanel.refresh();
    ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
    ctx.profileIndicator.refresh();
    ctx.statusbar.refresh();
    ctx.state.setModified(true);
    onProfileApplied();
  }

  async function handleClose(): Promise<void> {
    if (ctx.state.isSaving) return;
    if (!(await discardCurrentDocument('close'))) return;

    clearDocumentForReplacement();
    ctx.sidebar.hide();
    ctx.validationPanel.hide();
    onProfileApplied();
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
