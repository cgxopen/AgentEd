/**
 * Structured document format — two layouts supported (ADR-027):
 *
 *   Sibling (AgentEd native):
 *     doc.md          ← markdown body + frontmatter
 *     doc/
 *       assets/       ← images embedded in doc, plus other resources
 *       <other>/      ← arbitrary files preserved as archiveEntries
 *       .agented-meta.json
 *
 *   Parent-as-folder (ecosystem — Anthropic skill-creator, OpenClaw):
 *     parent/
 *       SKILL.md      ← markdown body + frontmatter
 *       assets/       ← images etc.
 *       scripts/, references/, agents/, ... ← archive entries
 *       .agented-meta.json
 *
 * Either way, `docFolder` is passed in explicitly by the caller
 * (loadDocument uses detectDocumentShape). Everything under docFolder
 * is loaded with the same convention; only where docFolder lives
 * relative to rootPath differs between layouts.
 *
 * embeddings/ folder was removed in v3 — will return in Pro.
 */

import { basename, dirname, joinPath, stripExtension } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { isImagePath, rewriteAttachmentsPathsInBody } from './assets';
import { assembleMarkdown, splitFrontmatter } from './frontmatter';
import { sha256 } from './hash';
import { createMeta } from './meta';
import type {
  AgentedMeta,
  ArchiveEntry,
  DocumentBundle,
  DocumentImage,
  StructuredLayout,
} from './types';

const EXCLUDE = new Set(['.agented-meta.json', 'embeddings']);

export async function loadStructured(
  path: string,
  docFolder: string,
  layout: StructuredLayout,
  io: PlatformIO,
): Promise<DocumentBundle> {
  // Step 1: migrate legacy attachments/ folder if needed
  const migrated = await migrateLegacyAttachments(docFolder, io);

  // Step 2: read the markdown file + meta
  const [text, meta] = await Promise.all([io.readText(path), loadMeta(docFolder, io)]);

  const { raw, body: rawBody } = splitFrontmatter(text);
  const body = migrated ? rewriteAttachmentsPathsInBody(rawBody) : rawBody;

  // Step 3: persist body rewrite to disk if we migrated
  if (migrated) {
    const newText = raw ? `---\n${raw}\n---\n${body}` : body;
    try {
      await io.saveFile(path, newText);
    } catch (e) {
      console.error(`[agented] Failed to persist migrated body for ${path}:`, e);
    }
  }

  // Step 4: load assets/ recursively, split into images and archive entries.
  // In parent-as-folder layout, the markdown file itself (e.g. SKILL.md)
  // sits inside docFolder and must be excluded from the archive listing.
  const rootExcludes = new Set(EXCLUDE);
  if (layout === 'parent-as-folder') {
    rootExcludes.add(pathBasename(path));
  }
  const { images, archiveEntries } = await loadStructuredContents(docFolder, io, rootExcludes);

  return {
    frontmatterRaw: raw,
    markdownBody: body,
    images,
    archiveEntries,
    rootPath: path,
    meta,
    docFolder,
    layout,
  };
}

function pathBasename(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/**
 * Reproduce the Save As layout decision when a structured save runs
 * without a resolved docFolder. Matches `applyLayoutFromFilename` in
 * document-actions.ts — keep the two in sync.
 */
function inferDocFolderFromRootPath(rootPath: string): string {
  if (basename(rootPath).toLowerCase() === 'skill.md') {
    return dirname(rootPath);
  }
  return stripExtension(rootPath);
}

async function loadMeta(docFolder: string, io: PlatformIO): Promise<AgentedMeta | null> {
  try {
    const content = await io.readText(joinPath(docFolder, '.agented-meta.json'));
    return JSON.parse(content) as AgentedMeta;
  } catch {
    return null;
  }
}

/**
 * Load all companion-folder contents and split into images (→ bundle.images)
 * and non-images (→ bundle.archiveEntries). Images from assets/ render in
 * the editor; everything else is preserved as archive entries for sidebar
 * display and round-trip save.
 */
async function loadStructuredContents(
  docFolder: string,
  io: PlatformIO,
  topLevelExcludes: Set<string>,
): Promise<{ images: DocumentImage[]; archiveEntries: ArchiveEntry[] }> {
  const archiveList = await listRecursive(io, docFolder, docFolder, topLevelExcludes);

  const images: DocumentImage[] = [];
  const archiveEntries: ArchiveEntry[] = [];

  for (const entry of archiveList) {
    if (entry.isDirectory) continue;
    const data = await io.readBinary(joinPath(docFolder, entry.relativePath));

    if (entry.relativePath.startsWith('assets/') && isImagePath(entry.relativePath)) {
      const filename = entry.relativePath.split('/').pop() || entry.relativePath;
      images.push({ relativePath: entry.relativePath, data, filename });
    } else {
      archiveEntries.push({ path: entry.relativePath, kind: 'file', data });
    }
  }

  return { images, archiveEntries };
}

/**
 * Migrate folder `attachments/` → `assets/` if legacy folder exists and
 * new one doesn't. Returns true if migration happened (caller rewrites body).
 */
async function migrateLegacyAttachments(docFolder: string, io: PlatformIO): Promise<boolean> {
  const oldDir = joinPath(docFolder, 'attachments');
  const newDir = joinPath(docFolder, 'assets');

  const [hasOld, hasNew] = await Promise.all([io.exists(oldDir), io.exists(newDir)]);

  if (!hasOld) return false;

  if (hasNew) {
    console.warn(
      `[agented] Both attachments/ and assets/ exist in ${docFolder}. ` +
        `Using assets/. Manual cleanup of attachments/ recommended.`,
    );
    return false;
  }

  try {
    const entries = await io.listDir(oldDir);
    await io.mkdir(newDir);

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const data = await io.readBinary(joinPath(oldDir, entry.name));
      await io.writeBinary(joinPath(newDir, entry.name), data);
    }

    await io.remove(oldDir);
    console.log(`[agented] Migrated attachments/ → assets/ in ${docFolder}`);
    return true;
  } catch (e) {
    console.error(`[agented] Failed to migrate attachments/ in ${docFolder}:`, e);
    return false;
  }
}

/**
 * Recursively list directory contents relative to rootPath.
 * Top-level entries in excludeNames are skipped. All path construction
 * goes through `joinPath` from platform/paths so separators are
 * forward-slash-normalized end-to-end.
 */
async function listRecursive(
  io: PlatformIO,
  rootPath: string,
  basePath: string,
  excludeNames: Set<string>,
): Promise<Array<{ relativePath: string; isDirectory: boolean }>> {
  const results: Array<{ relativePath: string; isDirectory: boolean }> = [];

  async function walk(currentPath: string, currentRelative: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof io.listDir>>;
    try {
      entries = await io.listDir(currentPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (currentPath === basePath && excludeNames.has(entry.name)) continue;
      const relative = currentRelative ? joinPath(currentRelative, entry.name) : entry.name;
      results.push({ relativePath: relative, isDirectory: entry.isDirectory });
      if (entry.isDirectory) {
        await walk(joinPath(currentPath, entry.name), relative);
      }
    }
  }

  await walk(rootPath, '');
  return results;
}

export async function saveStructured(bundle: DocumentBundle, io: PlatformIO): Promise<void> {
  const fullText = assembleMarkdown(bundle);
  await io.saveFile(bundle.rootPath, fullText);

  if (!io.supportsMultiFile) return;

  // Infer docFolder from rootPath if missing. Happens when the user
  // opens a plain .md (detected as markdown), manually switches to
  // structured, and presses Save. Without this fallback the save
  // would throw. The inference rule mirrors Save As: filename
  // `SKILL.md` → parent-as-folder, anything else → sibling.
  const docFolder = bundle.docFolder ?? inferDocFolderFromRootPath(bundle.rootPath);
  const assetsDir = joinPath(docFolder, 'assets');

  await io.mkdir(assetsDir);

  // relativePath is "assets/foo.png" → disk path is docFolder/assets/foo.png
  if (bundle.images.length > 0) {
    await Promise.all(
      bundle.images.map((img) => io.writeBinary(joinPath(docFolder, img.relativePath), img.data)),
    );
  }

  // Archive entries use paths relative to docFolder (no docName prefix)
  if (bundle.archiveEntries.length > 0) {
    await Promise.all(
      bundle.archiveEntries.map(async (entry) => {
        if (entry.kind === 'directory') return;
        if (!entry.data) return;
        await io.writeBinary(joinPath(docFolder, entry.path), entry.data);
      }),
    );
  }

  const hash = await sha256(fullText);
  const meta = createMeta(bundle.images.length, hash, bundle.meta);
  await io.saveFile(joinPath(docFolder, '.agented-meta.json'), JSON.stringify(meta, null, 2));
}
