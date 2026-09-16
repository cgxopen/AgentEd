import { confirmAssetsDir } from './app/assets-dir';
import { summariseAssets } from './app/assets-summary';
import { installCloseGuard } from './app/close-guard';
import { refreshClusterDetection, reportNothingRelated } from './app/cluster-scan';
import { createContext } from './app/context';
import { createDocumentActions, type DocumentActions } from './app/document-actions';
import { installDropGuard } from './app/drop-guard';
import { createErrorReporter } from './app/error-reporter';
import { setupFileAssociation } from './app/file-association';
import { setupHeader, wireHeaderIndicators } from './app/header-wiring';
import { createImageInsertReporter } from './app/image-insert-report';
import { metadataMenuCallbacks } from './app/insert-metadata';
import { setupKeyboard } from './app/keyboard';
import { type LinkDialog, setupLinkDialog } from './app/link-dialog';
import { installLinkOpener } from './app/link-open';
import { insertMedia } from './app/media-picker';
import { createSearchManager } from './app/search-manager';
import { createSidebarClickHandler } from './app/sidebar-click';
import { refreshSidebar as refreshSidebarModule } from './app/sidebar-sync';
import { AppState } from './app/state';
import { tableMenuCallbacks } from './app/table-dialog';
import { ThemeManager } from './app/theme-manager';
import { followPaletteWithTheWindow } from './app/window-appearance';
import { historyAvailability, historyMenuCallbacks } from './editor/history-routes';
import { insertMenuCallbacks } from './editor/insert-blocks';
import { codeBlockRoutes } from './editor/insert-code-block';
import { createEditor } from './editor/setup';
import { applyWindowAppearance, getPlatformIO, requestFolderAccess } from './platform/index';
import { purgeLegacyPreferences } from './preferences';
import { showAboutDialog } from './ui/about-dialog';
import { setupAppearanceMenu } from './ui/appearance-menu';
import { setupAssetsPopover } from './ui/assets-popover';
import { setupClusterIndicator } from './ui/cluster-indicator';
import { setupClusterPopover } from './ui/cluster-popover';
import { setupDocumentBadges } from './ui/document-badges';
import { emojiMenuCallbacks } from './ui/emoji-palette';
import { setupFrontmatterPanel, shouldShowFrontmatterPanel } from './ui/frontmatter-panel';
import { setupMenu } from './ui/menu';
import { setupSidebar } from './ui/sidebar';
import { setupSpellcheckToggle, setupStatusbar } from './ui/statusbar';
import { showTemplateGallery } from './ui/template-gallery';
import { setupToolbar } from './ui/toolbar';

// Sweep deprecated localStorage keys before any preference read runs.
// One-shot per launch; subsequent runs are no-ops.
purgeLegacyPreferences();

// Phase 1 — core state that nothing else depends on.
const state = new AppState();
const reporter = createErrorReporter();
const ctx = createContext(state, reporter);

// The single place that decides what an image insert says: the cue when
// one lands (#48), the message when the application refuses, and the
// silence when the user cancels (#61). It never writes anything — the
// save flow stays the only thing that does.
const reportImageInsert = createImageInsertReporter(state);

// Theme is applied as early as possible to avoid a flash of the wrong
// palette before the menu binds. It doesn't participate in the phased
// ctx because no other module consumes it — it owns its own DOM effect.
const themeManager = new ThemeManager();

// Phase 2 — header DOM wiring. Produces helpers we stash onto ctx so
// downstream consumers don't need a separate import for them.
const header = setupHeader(state);
ctx.setFilename = header.setFilename;
ctx.updateCloseEnabled = header.updateCloseEnabled;

// Phase 3 — editor. The editor's callbacks reach into docActions
// (set in Phase 6) via late binding.
let docActions!: DocumentActions;

const editorEl = document.getElementById('editor')!;
const { editor, getMarkdown, setMarkdown } = createEditor(
  editorEl,
  () => {
    ctx.state.setModified(true);
  },
  {
    getFilePath: () => ctx.state.filePath,
    requestSaveAs: () => docActions.requestSaveAs(),
    confirmAssetsDir: async () => {
      const path = ctx.state.filePath;
      if (!path) return null;
      const io = await getPlatformIO();
      return confirmAssetsDir(path, io, ctx.state);
    },
    // Asked by the insert flow *after* the destination step, never before
    // (#46) — on the web build that step is what grants the access this
    // answers about.
    canWriteCompanions: async () => {
      const path = ctx.state.filePath;
      if (!path) return false;
      const io = await getPlatformIO();
      return io.canWriteCompanions(path);
    },
    report: reportImageInsert,
  },
);
ctx.editor = editor;
ctx.getMarkdown = getMarkdown;
ctx.setMarkdown = setMarkdown;

// Phase 4 — UI panels that attach to the editor. The link dialog itself is
// built in Phase 8 (it needs no more than the editor, but it lives with the
// other dialogs); the toolbar reaches it by late binding, as it does for
// docActions.
let linkDialog!: LinkDialog;
ctx.statusbar = setupStatusbar(editor);
setupSpellcheckToggle(state);
setupToolbar(editor, { onLink: () => linkDialog.open() });

// Ctrl/Cmd+click follows a link; a plain click still places the caret (#25).
installLinkOpener(editorEl, {
  openExternal: async (url) => {
    const io = await getPlatformIO();
    await io.openWithSystem(url);
  },
});

// The other half of "this window never navigates away from the document"
// (#65). A drop the editor did not take would otherwise be handled by the
// browser, which replaces the page with the dropped file — the app gone,
// unsaved work with it, and no gate in front of it (R-C3). Installed on
// the window rather than on the editor: the header, the sidebar and the
// statusbar are drop targets too.
installDropGuard();

ctx.sidebar = setupSidebar();
ctx.frontmatterPanel = setupFrontmatterPanel(state);
ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(state));

// The R-C12 document-kind badges, and the popover «Images» opens.
//
// **Both halves are subscriptions rather than calls at the sites that
// change the document** (#196). «Images» rides on the editor's own
// update event, beside the counts; «Metadata» rides on
// `onFrontmatterChange`, which every writer of the block goes through
// now that `AppState.frontmatter` is an accessor. Wiring either from the
// places that replace a document instead would mean four call sites to
// keep in step, and the one that would have been missed is the panel's
// own textarea — the route where a user empties the metadata and
// whatever was drawn from it stays on screen.
ctx.assetsPopover = setupAssetsPopover({
  loadSummary: async () => {
    const io = await getPlatformIO();
    return summariseAssets(editor, ctx.state.filePath, io);
  },
});
const documentBadges = setupDocumentBadges(editor, {
  onImagesToggle: () => ctx.assetsPopover.toggle(),
});
// `transaction` rather than `update`, and it is not a preference (#196):
// `update` is not emitted for a transaction carrying `preventUpdate`, and
// `setContent` sets exactly that — so a badge wired to `update` would have
// been right for every keystroke and wrong for every document ever opened.
// `docChanged` is then the filter that keeps a selection move free.
editor.on('transaction', ({ transaction }) => {
  if (!transaction.docChanged) return;
  documentBadges.refreshImages();
});
state.onFrontmatterChange((frontmatter) => documentBadges.refreshMetadata(frontmatter));
documentBadges.refreshMetadata(state.frontmatter);
documentBadges.refreshImages();

// Phase 5 — managers (need editor + panels in ctx).
// SearchManager owns the inline search panel + the vendor extension
// wrapper. We construct it here (before docActions) so its keyboard
// listeners install during Phase 8 and the panel root in index.html is
// already in the DOM. The `onOpen` hook closes the cluster popover so
// only one floating surface is visible at a time.
ctx.searchManager = createSearchManager({
  editor,
  panelRoot: document.getElementById('search-panel')!,
  onOpen: () => {
    if (ctx.clusterPopover?.isOpen()) ctx.clusterPopover.close();
    if (ctx.assetsPopover?.isOpen()) ctx.assetsPopover.close();
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
  // Refresh is a question the user asked, so its scan answers even when
  // the answer is nothing (#130). The automatic scans behind `applyBundle`
  // use `scheduleClusterDetection` instead and stay silent.
  onRefresh: async () => {
    if (!ctx.state.filePath) return;
    const io = await getPlatformIO();
    await refreshClusterDetection(ctx.state.filePath, ctx, io);
  },
  onNothingToShow: reportNothingRelated,
});

// Phase 8 — wiring that needs docActions.
wireHeaderIndicators(ctx, docActions);

ctx.sidebar.setOnFileClick(createSidebarClickHandler(docActions, getPlatformIO));

// The offer the absent panel carries on the web (#184). The refresh is in
// the same gesture on purpose: a grant that needed a reload to take effect
// would answer the user's click with nothing visible.
ctx.sidebar.setOnRequestAccess(() => {
  void (async () => {
    // Only on a grant. A cancelled picker changed nothing, so nothing is
    // redrawn and nothing is said (#61).
    if (!(await requestFolderAccess())) return;
    await ctx.refreshSidebar();
    // **The user asked, so the answer is theirs even when it is
    // nothing** (#130). A refresh that leaves the panel hidden means the
    // granted folder holds nothing beside the document — true, complete,
    // and silence would answer a question with an absence.
    //
    // The check lives here rather than in `refreshSidebar` because this
    // is the only place that knows a question was put. Every other route
    // into that state reaches it without anyone asking, and stays
    // silent.
    if (!ctx.sidebar.isVisible()) ctx.sidebar.showNothingRelated();
  })().catch(console.error);
});

linkDialog = setupLinkDialog(editor);
// One object, spread into the menu and into the keyboard, so a swap between
// the two routes is made in one place and the tests drive that place (#279).
const codeBlock = codeBlockRoutes(editor);

setupMenu(
  {
    onNew: () => {
      void docActions.handleNew().catch(console.error);
    },
    onNewFromTemplate: () => {
      void (async () => {
        const templateId = await showTemplateGallery();
        if (!templateId) return;
        await docActions.handleNewFromTemplate(templateId);
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
    ...historyMenuCallbacks(editor),
    ...tableMenuCallbacks(editor),
    ...codeBlock,
    ...insertMenuCallbacks(ctx.editor),
    ...metadataMenuCallbacks(ctx.state, ctx.frontmatterPanel),
    ...emojiMenuCallbacks(editor),
    onInsertMedia: () => {
      void insertMedia({
        state: ctx.state,
        editor: ctx.editor,
        requestSaveAs: docActions.requestSaveAs,
        reporter: ctx.reporter,
        report: reportImageInsert,
      }).catch(console.error);
    },
    onToggleSidebar: () => {
      ctx.sidebar.toggle();
    },
    onAbout: () => {
      void showAboutDialog().catch(console.error);
    },
  },
  () => historyAvailability(editor),
);

// Appearance (Mode + Palette) lives in its own kebab menu in the
// header, not the hamburger. The menu is a pure view over
// ThemeManager — it reads + writes the manager, which owns
// persistence and applies the theme to the document.
ctx.appearanceMenu = setupAppearanceMenu(themeManager);

// The window frame takes the palette's own surface colour where the platform
// has a frame of its own to paint (#326). Through `src/platform`, which is
// where every OS call lives; on the web and on a Windows without the
// mechanism this asks for something nobody does, silently.
followPaletteWithTheWindow(themeManager, (appearance) => {
  void applyWindowAppearance(appearance);
});

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
  onLink: () => linkDialog.open(),
  ...codeBlock,
});

setupFileAssociation(docActions.openFilePath);

// The window's own close button, Alt+F4 and app quit are destructive paths
// too, so they route through the same unsaved-changes gate (R-C3). Awaited
// lazily: the platform module loads on demand, and a failure to install
// must be loud — silently losing the guard would be a data-loss path.
void (async () => {
  const io = await getPlatformIO();
  await installCloseGuard(ctx.state, docActions, io);
})().catch((e) => {
  console.error('[main] failed to install the close guard:', e);
  void ctx.reporter.dialog(
    'AgentEd could not protect against closing with unsaved changes.\n\n' +
      'Please save your work manually before closing the window.',
    e,
    'Close protection unavailable',
  );
});

// Phase 9 — initial render + runtime event listeners.
ctx.updateCloseEnabled();
