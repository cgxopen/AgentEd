import { splitFrontmatter } from '../formats/frontmatter';
import { basename, stripExtension } from '../platform/paths';
import { getTemplate } from '../templates';
import type { FrontmatterPanel } from '../ui/frontmatter-panel';
import type { AppState } from './state';

/**
 * Insert Metadata (#297): the route that gives a document already open a
 * metadata block, which before it could only be had by starting a new document
 * from the Blank + metadata template.
 *
 * **The block is the template block, read from the template rather than
 * restated**, so the two routes cannot drift apart. The one line that differs
 * is the title, by owner decision on #297: a document that has a file takes its
 * title from the file name, and one that has no file yet keeps `Untitled`, as
 * the template writes it. `insert-metadata.test.ts` pins that every other line
 * equals the template.
 *
 * **Not empty, and measured rather than preferred.** An empty block makes the
 * panel appear and writes nothing: `assembleMarkdown` drops a block whose text
 * is empty, so the file on disk would never acquire one (#297 step zero).
 */

const TEMPLATE_ID = 'blank-frontmatter';

/** The line of the block that carries the title. */
const TITLE_LINE = /^title:.*$/m;

/** The metadata block the Blank + metadata template starts with. */
function templateBlock(): string {
  const template = getTemplate(TEMPLATE_ID);
  const block = template ? splitFrontmatter(template.body).raw : null;
  if (block === null || !TITLE_LINE.test(block)) {
    throw new Error('the Blank + metadata template no longer starts with a block holding a title');
  }
  return block;
}

/** Words YAML reads as a boolean or as null rather than as text. */
const YAML_RESERVED = /^(true|false|yes|no|on|off|y|n|null|~)$/i;

/** A name YAML reads back as the same text when written plainly after `title: `. */
const YAML_PLAIN = /^\p{L}[\p{L}\p{N} _.()-]*$/u;

/**
 * The title as YAML text. Plain when YAML would read it back unchanged, and
 * single-quoted otherwise, with any single quote doubled: a name that YAML
 * would type as a boolean, a number or a date, one holding `: ` or ` #`, and one
 * starting with an indicator character are all quoted, because the route must
 * not write a line that reads back as something else. This is not validation of
 * the block; it keeps the one line the route writes itself honest.
 */
export function yamlTitle(name: string): string {
  if (YAML_PLAIN.test(name) && !/\s$/.test(name) && !YAML_RESERVED.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

/**
 * The block Insert Metadata writes for a document at `filePath`: the template
 * block, with the title taken from the file name when there is one. A name with
 * nothing left once the extension is gone keeps the template title.
 */
export function metadataBlockFor(filePath: string | null): string {
  const block = templateBlock();
  const name = filePath === null ? '' : stripExtension(basename(filePath));
  if (name === '') return block;
  // A function rather than a replacement string, so a `$` in a file name is
  // written as a `$` and not read as a replacement pattern.
  return block.replace(TITLE_LINE, () => `title: ${yamlTitle(name)}`);
}

/**
 * Gives the document its block when it has none, and in either case shows the
 * panel with focus in its field. **A document that already has a block is left
 * exactly as it is** (owner decision (c) on #297): the entry stays active and
 * opens the panel, and it changes nothing in the document.
 */
export function insertMetadata(state: AppState, panel: FrontmatterPanel): void {
  if (state.frontmatter === null) {
    state.frontmatter = metadataBlockFor(state.filePath);
    panel.refresh();
    state.setModified(true);
  }
  panel.reveal();
}

export interface MetadataMenuCallbacks {
  readonly onInsertMetadata: () => void;
}

/**
 * The menu mapping, as one object `main.ts` spreads into `setupMenu`, so the
 * tests drive the same object rather than restating it.
 */
export function metadataMenuCallbacks(
  state: AppState,
  panel: FrontmatterPanel,
): MetadataMenuCallbacks {
  return { onInsertMetadata: () => insertMetadata(state, panel) };
}
