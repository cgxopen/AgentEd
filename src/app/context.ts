import type { Editor } from '@tiptap/core';
import type { AppearanceMenu } from '../ui/appearance-menu';
import type { AssetsPopover } from '../ui/assets-popover';
import type { ClusterIndicator } from '../ui/cluster-indicator';
import type { ClusterPopover } from '../ui/cluster-popover';
import type { FrontmatterPanel } from '../ui/frontmatter-panel';
import type { Sidebar } from '../ui/sidebar';
import type { Statusbar } from '../ui/statusbar';
import type { ErrorReporter } from './error-reporter';
import type { SearchManager } from './search-manager';
import type { AppState } from './state';

/**
 * Central dependency container. Built once in main.ts and passed by
 * reference to every module that needs shared services. Replaces the
 * per-module dependency objects (DocumentActionsDeps with 13 fields,
 * IndicatorWiringDeps with 6, ApplyBundleDeps with 6) which had
 * become a readability tax for new contributors.
 *
 * Population is phased in main.ts (see the numbered Phase comments).
 * Only `state` and `reporter` are fixed at construction time; every
 * other field is assigned as its producer becomes available. Consumers
 * access fields through `ctx.field` (not destructured at call-site) so
 * the late-binding is explicit and safe.
 *
 * Downstream functions are called in Phase 7+ of main.ts, after the
 * full context is populated.
 */
export interface AppContext {
  readonly state: AppState;
  readonly reporter: ErrorReporter;

  // Phase 3: editor
  editor: Editor;
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;

  // Phase 4: UI panels
  statusbar: Statusbar;
  sidebar: Sidebar;
  frontmatterPanel: FrontmatterPanel;
  clusterIndicator: ClusterIndicator;
  clusterPopover: ClusterPopover;
  /** The R-C12 «Images» popover, opened from the badge of the same name. */
  assetsPopover: AssetsPopover;
  appearanceMenu: AppearanceMenu;

  // Phase 5: managers
  searchManager: SearchManager;

  // Phase 6: helpers produced from ctx
  refreshSidebar: () => Promise<void>;
  setFilename: (name: string | null, fullPath?: string | null) => void;
  updateCloseEnabled: () => void;
}

/**
 * Construct a context seeded with Phase 1 values. The rest of the
 * fields are populated by main.ts before any consumer is called.
 * The `as AppContext` cast is intentional: TypeScript can't track the
 * phased assignments, and treating the object as "fully built" at
 * call-sites is the whole point of this container.
 */
export function createContext(state: AppState, reporter: ErrorReporter): AppContext {
  return { state, reporter } as AppContext;
}
