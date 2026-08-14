import { ensureAssetsDir } from './app/assets-dir';
import { buildBundle, scheduleClusterDetection } from './app/bundle';
import { createContext } from './app/context';
import { createDocumentActions, type DocumentActions } from './app/document-actions';
import { createErrorReporter } from './app/error-reporter';
import { setupFileAssociation } from './app/file-association';
import { setupHeader, wireHeaderIndicators } from './app/header-wiring';
import { setupKeyboard } from './app/keyboard';
import { insertMedia } from './app/media-picker';
import { ProfileManager } from './app/profile-manager';
import { createSearchManager } from './app/search-manager';
import { createSidebarClickHandler } from './app/sidebar-click';
import { refreshSidebar as refreshSidebarModule } from './app/sidebar-sync';
import { AppState } from './app/state';
import { setupTableDialog } from './app/table-dialog';
import { ThemeManager } from './app/theme-manager';
import { createEditor } from './editor/setup';
import { getPlatformIO } from './platform/index';
import { purgeLegacyPreferences } from './preferences';
import { detectProfileForBundle } from './profiles/detect-bundle';
import { getProfile } from './profiles/index';
import { setupAppearanceMenu } from './ui/appearance-menu';
import { setupClusterIndicator } from './ui/cluster-indicator';
import { setupClusterPopover } from './ui/cluster-popover';
import { setupFrontmatterPanel, shouldShowFrontmatterPanel } from './ui/frontmatter-panel';
import { setupMenu } from './ui/menu';
import { setupProfileIndicator } from './ui/profile-indicator';
import { setupSidebar } from './ui/sidebar';
import { setupSpellcheckToggle, setupStatusbar } from './ui/statusbar';
import { showTemplateGallery } from './ui/template-gallery';
import { setupToolbar } from './ui/toolbar';
import { setupValidationPanel } from './ui/validation-panel';

// Sweep deprecated localStorage keys before any preference read runs.
// One-shot per launch; subsequent runs are no-ops.
purgeLegacyPreferences();

// Phase 1 — core state that nothing else depends on.
const state = new AppState();
const reporter = createErrorReporter();
const ctx = createContext(state, reporter);

// Theme is applied as early as possible to avoid a flash of the wrong
// palette before the menu binds. It doesn't participate in the phased
// ctx because no other module consumes it — it owns its own DOM effect.
const themeManager = new ThemeManager();

// Phase 2 — header DOM wiring. Produces helpers we stash onto ctx so
// downstream consumers don't need a separate import for them.
const header = setupHeader(state);
ctx.setFilename = header.setFilename;
ctx.updateCloseEnabled = header.updateCloseEnabled;

// Phase 3 — editor. The editor's callbacks reach into ctx.profileManager
// (set in Phase 5) and docActions (set in Phase 7) via late binding.
let docActions!: DocumentActions;

const editorEl = document.getElementById('editor')!;
const { editor, getMarkdown, setMarkdown } = createEditor(
  editorEl,
  () => {
    ctx.state.setModified(true);
    ctx.profileManager.triggerValidationDebounced();
  },
  () => ctx.state.filePath,
  () => docActions.requestSaveAs(),
  () => {
    const profile = getProfile(ctx.state.profile);
    if (profile.allowsImagePaste) return { allowed: true };
    return { allowed: false, reason: `Image paste not supported for ${profile.displayName}.` };
  },
  async () => {
    const path = ctx.state.filePath;
    if (!path) return null;
    const io = await getPlatformIO();
    return ensureAssetsDir(path, io, ctx.state);
  },
);
ctx.editor = editor;
ctx.getMarkdown = getMarkdown;
ctx.setMarkdown = setMarkdown;

// Phase 4 — UI panels that attach to the editor.
ctx.statusbar = setupStatusbar(editor);
setupSpellcheckToggle(state);
setupToolbar(editor);
ctx.validationPanel = setupValidationPanel(() => {
  editor.commands.focus();
});
ctx.sidebar = setupSidebar();
ctx.frontmatterPanel = setupFrontmatterPanel(state);

// Profile indicator wires up after the panels — the override callback
// re-runs validation + frontmatter visibility, both of which need ctx.
ctx.profileIndicator = setupProfileIndicator(state, {
  onProfileChange: async (choice) => {
    if (choice === null) {
      ctx.state.profileOverridden = false;
      const io = await getPlatformIO();
      const bundle = buildBundle(ctx.state, ctx.getMarkdown);
      ctx.state.profile = await detectProfileForBundle(bundle, io);
    } else {
      ctx.state.profile = choice;
      ctx.state.profileOverridden = true;
    }
    ctx.profileIndicator.refresh();
    ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
    ctx.profileManager.triggerValidation();
    await ctx.refreshSidebar();
  },
});

// Phase 5 — managers (need editor + panels in ctx).
ctx.profileManager = new ProfileManager(ctx);

// SearchManager owns the inline search panel + the vendor extension
// wrapper. We construct it here (before docActions) so its keyboard
// listeners install during Phase 8 and the panel root in index.html is
// already in the DOM. The `onOpen` hook closes the cluster popover so
// only one floating surface is visible at a time (ADR-033 decision).
ctx.searchManager = createSearchManager({
  editor,
  panelRoot: document.getElementById('search-panel')!,
  onOpen: () => {
    if (ctx.clusterPopover?.isOpen()) ctx.clusterPopover.close();
  },
});
ctx.searchManager.installKeyboardListeners();

// Phase 6 — helpers that themselves need ctx.
ctx.refreshSidebar = async () => {
  const io = await getPlatformIO();
  await refreshSidebarModule(ctx.state, ctx.sidebar, io);
};

// Phase 6.5 — cluster indicator + popover. The indicator only needs
// the popover toggle callback (built right after); the popover needs
// docActions for the safety-gated open and a way to re-run detection.
ctx.clusterIndicator = setupClusterIndicator({
  onToggle: () => ctx.clusterPopover.toggle(ctx.state.cluster),
});
state.onClusterChange((cluster) => {
  ctx.clusterIndicator.refresh(cluster);
  // If the popover is open while a fresh scan lands, drop it — the
  // user is now looking at a different document and the entries list
  // would otherwise be stale.
  if (ctx.clusterPopover.isOpen()) ctx.clusterPopover.close();
});

// Phase 7 — document actions (depend on the full context).
docActions = createDocumentActions(ctx);

ctx.clusterPopover = setupClusterPopover({
  getIO: getPlatformIO,
  onOpenEntry: (path) => docActions.openFilePath(path),
  onRefresh: async () => {
    if (!ctx.state.filePath) return;
    const io = await getPlatformIO();
    scheduleClusterDetection(ctx.state.filePath, ctx, io);
  },
});

// Phase 8 — wiring that needs docActions.
wireHeaderIndicators(ctx, docActions);

ctx.sidebar.setOnFileClick(createSidebarClickHandler(docActions, getPlatformIO));

const tableDialog = setupTableDialog(editor);

setupMenu({
  onNew: () => {
    void docActions.handleNew().catch(console.error);
  },
  onNewFromTemplate: () => {
    void (async () => {
      const profileId = await showTemplateGallery();
      if (!profileId) return;
      await docActions.handleNewFromTemplate(profileId);
    })().catch(console.error);
  },
  onOpen: () => {
    void docActions.handleOpen().catch(console.error);
  },
  onSave: () => {
    void docActions.handleSave().catch(console.error);
  },
  onSaveAs: () => {
    void docActions.handleSaveAs().catch(console.error);
  },
  onClose: () => {
    void docActions.handleClose().catch(console.error);
  },
  onFind: () => ctx.searchManager.openFind(),
  onReplace: () => ctx.searchManager.openReplace(),
  onFindNext: () => ctx.searchManager.findNext(),
  onFindPrevious: () => ctx.searchManager.findPrevious(),
  onInsertTable: tableDialog.open,
  onInsertMedia: () => {
    void insertMedia({
      state: ctx.state,
      editor: ctx.editor,
      requestSaveAs: docActions.requestSaveAs,
      reporter: ctx.reporter,
    }).catch(console.error);
  },
  onToggleSidebar: () => {
    ctx.sidebar.toggle();
  },
});

// Appearance (Mode + Palette) lives in its own kebab menu in the
// header, not the hamburger. The menu is a pure view over
// ThemeManager — it reads + writes the manager, which owns
// persistence and applies the theme to the document.
ctx.appearanceMenu = setupAppearanceMenu(themeManager);

setupKeyboard({
  onSave: () => {
    void docActions.handleSave().catch(console.error);
  },
  onSaveAs: () => {
    void docActions.handleSaveAs().catch(console.error);
  },
  onOpen: () => {
    void docActions.handleOpen().catch(console.error);
  },
});

setupFileAssociation(docActions.openFilePath);

// Phase 9 — initial render + runtime event listeners.
ctx.profileManager.triggerValidation();
ctx.updateCloseEnabled();
