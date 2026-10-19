import { confirmAssetsDir } from './app/assets-dir';
import { summariseAssets, unusedAssetFiles } from './app/assets-summary';
import { installCloseGuard } from './app/close-guard';
import { createContext } from './app/context';
import { createDocumentActions, type DocumentActions } from './app/document-actions';
import { installDropGuard } from './app/drop-guard';
import { createErrorReporter } from './app/error-reporter';
import { setupFileAssociation } from './app/file-association';
import { setupHeader, wireHeaderIndicators } from './app/header-wiring';
import { imageDescriptionRoutes } from './app/image-description-dialog';
import { createImageInsertReporter } from './app/image-insert-report';
import { metadataMenuCallbacks } from './app/insert-metadata';
import { setupKeyboard } from './app/keyboard';
import { type LinkDialog, linkAvailability, setupLinkDialog } from './app/link-dialog';
import { installLinkOpener } from './app/link-open';
import { insertMedia } from './app/media-picker';
import { createSearchManager } from './app/search-manager';
import { createSidebarClickHandler } from './app/sidebar-click';
import { openSidebarByHand, refreshSidebar as refreshSidebarModule } from './app/sidebar-sync';
import { AppState } from './app/state';
import { tableMenuCallbacks } from './app/table-dialog';
import { ThemeManager } from './app/theme-manager';
import { setupWindowReports } from './app/window-reports';
import { isReplacingDocument } from './editor/document-load';
import { historyAvailability, historyMenuCallbacks } from './editor/history-routes';
import { imageDescriptionAvailability } from './editor/image-description';
import { insertMenuCallbacks } from './editor/insert-blocks';
import { codeBlockAvailability, codeBlockRoutes } from './editor/insert-code-block';
import { footnoteAvailability, footnoteMenuCallbacks } from './editor/insert-footnote';
import { type PredictablePasteStorage, requestPlainPaste } from './editor/paste';
import { selectAllMenuCallbacks } from './editor/select-all-route';
import { createEditor } from './editor/setup';
import { tableShapeAvailability, tableShapeMenuCallbacks } from './editor/table-shape';
import { isTauri } from './platform/detect';
import {
  getPlatformIO,
  ownWindowFrame,
  requestFolderAccess,
  titleBarOverlay,
} from './platform/index';
import { listenForPlainPasteRequest } from './platform/plain-paste';
import { clearRecentFiles, loadRecentFiles, purgeLegacyPreferences } from './preferences';
import { showAboutDialog } from './ui/about-dialog';
import { setupAppearanceMenu } from './ui/appearance-menu';
import { setupAssetsPopover } from './ui/assets-popover';
import { applyChordLabels } from './ui/chord-label';
import { documentReferencesImage, setupDocumentBadges } from './ui/document-badges';
import { emojiMenuCallbacks } from './ui/emoji-palette';
import { setupFrontmatterPanel, shouldShowFrontmatterPanel } from './ui/frontmatter-panel';
import { watchHeaderRoom } from './ui/header-room';
import { setupMenu } from './ui/menu';
import { setupSidebar } from './ui/sidebar';
import { setupSpellcheckToggle, setupStatusbar, spellcheckMenuCallbacks } from './ui/statusbar';
import { showTemplateGallery } from './ui/template-gallery';
import { setupToolbar } from './ui/toolbar';
import { drawOverlayFrame, drawWindowFrame } from './ui/window-frame';

// Sweep deprecated localStorage keys before any preference read runs.
// One-shot per launch; subsequent runs are no-ops.
purgeLegacyPreferences();
// Every chord the page names, spelled for the key this keymap binds (#558).
applyChordLabels(document);

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
  // Every change to the document asks the rule rather than setting the mark
  // (#441), so an undo back to the saved state clears it.
  () => {
    ctx.state.refreshModified();
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
// The one reader of the editor document for the modified rule (#441), set
// before any document is loaded; the empty document the editor starts with
// is the first snapshot, as a New would take it.
state.readEditorDocument = () => editor.state.doc;
state.markSaved(state.frontmatter);

// Phase 4 — UI panels that attach to the editor. The link dialog itself is
// built in Phase 8 (it needs no more than the editor, but it lives with the
// other dialogs); the toolbar reaches it by late binding, as it does for
// docActions.
let linkDialog!: LinkDialog;
let imageDescription!: { readonly onImageDescription: () => void };
ctx.statusbar = setupStatusbar(editor);
setupSpellcheckToggle(state);
setupToolbar(editor, {
  onLink: () => linkDialog.open(),
  onImageDescription: () => imageDescription.onImageDescription(),
});

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
// The grey of R-C6 (#380): a file in `assets/` the document does not use,
// from the answer the popover counts with. It reads only the document and the
// tree already drawn, so it follows every change as well as every draw.
function markUnusedAssets(): void {
  ctx.sidebar.markUnused(unusedAssetFiles(editor, ctx.state.filePath));
}

editor.on('transaction', ({ transaction }) => {
  if (!transaction.docChanged) return;
  documentBadges.refreshImages();
  markUnusedAssets();
  // The panel trigger of #402, from the same predicate and at the same
  // moment as the badge above, so the two cannot answer this document
  // differently. `applyLoadedDocument` puts the document in the editor before
  // `refreshSidebar` asks, so the value is current by the time it is read.
  //
  // **The two read it at different moments, and that was the defect** (#418,
  // point f). The badge above withdraws on this transaction; the panel reads
  // the field only when `refreshSidebar` runs, which is an open, a reload, a
  // save, a Save As or a folder grant - never an edit. So deleting the last
  // image of a document left the badge gone and the panel still listing the
  // folder, every file in it greyed, until the next save. R-C6 says the two
  // controls cannot answer one document differently, and for that window they
  // did.
  //
  // **The redraw is on the crossing, not on the edit** (owner decision of
  // 2026-09-22). The value is a boolean and an ordinary edit does not move it,
  // so this asks at most once per document per direction - typing a word into
  // a document with a picture asks nothing. `refreshSidebar` reads a directory,
  // which is why it is not put on every transaction.
  const referencesImage = documentReferencesImage(editor);
  const crossed = referencesImage !== state.referencesImage;
  state.referencesImage = referencesImage;
  if (!crossed) return;
  // **A document arriving crosses on the way in, and its route redraws the
  // panel itself**, so redrawing here as well would read the directory twice
  // on every open of a document holding a picture. `isReplacingDocument` is
  // true for exactly the transactions a whole-document replacement produces,
  // at the one address R-C16 already guarantees every route reaches.
  if (isReplacingDocument()) return;
  // `same-document` rather than `document-arrived`: the person is editing the
  // document they are in, so a panel they closed by hand stays closed (#387).
  void ctx.refreshSidebar('same-document').catch((e: unknown) => {
    console.error('[main] the files panel could not be redrawn after an edit:', e);
  });
});
state.onFrontmatterChange((frontmatter) => documentBadges.refreshMetadata(frontmatter));
documentBadges.refreshMetadata(state.frontmatter);
documentBadges.refreshImages();

// Phase 5 — managers (need editor + panels in ctx).
// SearchManager owns the inline search panel + the vendor extension
// wrapper. We construct it here (before docActions) so its keyboard
// listeners install during Phase 8 and the panel root in index.html is
// already in the DOM. The `onOpen` hook closes the «Images» popover so
// only one floating surface is visible at a time.
ctx.searchManager = createSearchManager({
  editor,
  panelRoot: document.getElementById('search-panel')!,
  onOpen: () => {
    if (ctx.assetsPopover?.isOpen()) ctx.assetsPopover.close();
  },
});
ctx.searchManager.installKeyboardListeners();

// Phase 6 — helpers that themselves need ctx.
ctx.refreshSidebar = async (redraw) => {
  const io = await getPlatformIO();
  await refreshSidebarModule(ctx.state, ctx.sidebar, io, redraw);
  markUnusedAssets();
};

// Phase 7 — document actions (depend on the full context).
docActions = createDocumentActions(ctx);

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
    // is one of the two places that know a question was put; the other is
    // the open by hand below (#354). A document switch into that state
    // reaches it without anyone asking, and stays silent.
    if (!ctx.sidebar.isVisible()) ctx.sidebar.showNothingRelated();
  })().catch(console.error);
});

// An open by hand is a question, so the panel is drawn again for the
// document on screen, and every state answers (#354). The header control and
// `Ctrl+Shift+E` both reach it, through `toggle`.
ctx.sidebar.setOnOpenByHand((ticket) => {
  void (async () => {
    const io = await getPlatformIO();
    await openSidebarByHand(ctx.state, ctx.sidebar, io, ticket);
    markUnusedAssets();
  })().catch(console.error);
});

linkDialog = setupLinkDialog(editor);
// One object for the two doors of #291 — the toolbar button and the Edit
// entry — so a handler moved onto another entry is a change made in one place.
imageDescription = imageDescriptionRoutes(editor);
// One object, spread into the menu and into the keyboard, so a swap between
// the two routes is made in one place and the tests drive that place (#279).
const codeBlock = codeBlockRoutes(editor);

let keepsRecentFiles = false;
void getPlatformIO()
  .then((io) => {
    keepsRecentFiles = io.pathsOutliveSession === true;
  })
  .catch(console.error);

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
    onOpenRecentFile: (path) => {
      void docActions.openRecentFile(path).catch(console.error);
    },
    onClearRecentFiles: clearRecentFiles,
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
    ...selectAllMenuCallbacks(editor),
    ...tableMenuCallbacks(editor),
    ...tableShapeMenuCallbacks(editor),
    ...imageDescription,
    ...codeBlock,
    ...insertMenuCallbacks(ctx.editor),
    ...footnoteMenuCallbacks(ctx.editor),
    ...metadataMenuCallbacks(ctx.state, ctx.frontmatterPanel),
    ...emojiMenuCallbacks(editor),
    ...spellcheckMenuCallbacks(ctx.state),
    // The same `open` the toolbar button and Ctrl+K call, so the three doors
    // are one code path (#450).
    onInsertLink: () => linkDialog.open(),
    onInsertMedia: () => {
      void insertMedia({
        state: ctx.state,
        editor: ctx.editor,
        requestSaveAs: docActions.requestSaveAs,
        reporter: ctx.reporter,
        report: reportImageInsert,
      }).catch(console.error);
    },
    onAbout: () => {
      void showAboutDialog().catch(console.error);
    },
  },
  () => historyAvailability(editor),
  // One reading, answered by the module that owns each entry.
  () => ({
    ...tableShapeAvailability(editor),
    ...imageDescriptionAvailability(editor),
    ...footnoteAvailability(editor),
    ...codeBlockAvailability(editor),
    ...linkAvailability(editor),
  }),
  // No list until the platform has said its paths outlive the session (#381),
  // which it answers once it has loaded; the web build never does.
  () => (keepsRecentFiles ? loadRecentFiles() : null),
);

// Appearance (Mode + Palette) opens from its own trigger at the right of the
// header — the half-filled circle since #330, and not the hamburger beside
// it. The menu is a pure view over ThemeManager — it reads + writes the
// manager, which owns persistence and applies the theme to the document.
ctx.appearanceMenu = setupAppearanceMenu(themeManager);

// The word and character counts give way to the document name rather than to a
// window width (#413). Wired here rather than with the rest of the header in
// Phase 2 because the bar it measures is not itself until the statusbar has
// written the counts, which happens in Phase 4.
const measureHeaderRoom = watchHeaderRoom();

// On Windows the header and the title bar are one bar, drawn here (#366):
// the platform hands over the window controls where the build has no native
// frame, and nothing anywhere else.
void ownWindowFrame()
  .then((controls) => {
    if (controls) {
      drawWindowFrame(controls);
      // The brand and the caption buttons are part of what never gives way, so
      // the answer taken a moment ago was taken against a different bar.
      measureHeaderRoom();
    }
  })
  .catch((e: unknown) => console.error('[main] the window frame could not be drawn:', e));

// On macOS the system buttons stand over the header, which becomes the title
// bar (#615): the platform hands over the window where its config says so.
void titleBarOverlay()
  .then((overlay) => {
    if (overlay) {
      drawOverlayFrame(overlay);
      measureHeaderRoom();
    }
  })
  .catch((e: unknown) => console.error('[main] the overlay frame could not be drawn:', e));

setupKeyboard({
  onSave: () => {
    void docActions.handleSave().catch(console.error);
  },
  onOpen: () => {
    void docActions.handleOpen().catch(console.error);
  },
  onLink: () => linkDialog.open(),
  onToggleSidebar: () => {
    ctx.sidebar.toggle();
  },
  ...codeBlock,
});

// Before the file association asks for its document, since that ask is what
// tells a macOS window it is one of several (#559).
setupWindowReports(ctx.state, header.onFilenameChange, (e) => {
  void ctx.reporter.dialog(
    'AgentEd could not tell macOS whether this window has unsaved changes.\n\n' +
      'Please save your work before quitting.',
    e,
    'Unsaved changes not reported',
  );
});
setupFileAssociation(docActions.openFilePath);
// Paste and Match Style chosen from the macOS Edit menu (#558). Asked of the
// platform name because the question is whether a desktop menu bar exists to
// send it; the web build has none, as `file-association.ts` asks for its event.
if (isTauri) {
  listenForPlainPasteRequest(() => {
    requestPlainPaste(editor.storage.predictablePaste as PredictablePasteStorage);
  }).catch(console.error);
}

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
