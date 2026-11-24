import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { parseDocument } from '../editor/document-load';
import { isRelativeLinkAddress } from '../editor/link-url';
import { parseMarkdown } from '../formats/plain';
import { isMarkdownPath, joinPath, samePath } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { checkLinks, collectLinks, type DocumentLink, type LinkCheckResult } from './link-check';

/**
 * The broken link check of every markdown file in the folder the files panel
 * shows (#766), started by hand. It reports and repairs nothing, and writes
 * nothing.
 *
 * **One reader, the editor.** A file that is not open is read through
 * `src/platform` and taken by the route a load takes (`parseMarkdown`,
 * `parseDocument`, `collectLinks`), so its links are the links the editor
 * would draw: an `a` element written as HTML among them, which the tokens of
 * marked alone do not give as a link (3212 relative links on the census in the
 * step zero of #766). The open file is read from the editor, as the check of
 * #729 reads it, never from the disk. Each address then goes through
 * `checkLinks` of #729, so through `resolveLinkTarget` and the presence
 * question it asks: web addresses are never looked at, and what is not
 * established is not checked, never broken.
 *
 * **Nothing in the editor moves.** `parseDocument` builds a node from the
 * schema and `collectLinks` reads it; neither dispatches a transaction, so the
 * document, its history and its selection stay as they were.
 *
 * **Bounded four times, each said in the report** (owner decision of
 * 2026-11-24 on #766): the files of one check, the links of one file, the
 * relative links of one check, the bytes of one file. There is no bound on
 * time; the person may stop the check at any moment, and it stops before the
 * next file.
 *
 * **It runs on the main thread** and gives it up at the read of each file,
 * an IPC call awaited anyway: `parseDocument` needs the DOM, which a worker
 * does not have. A keystroke may wait for the file being read, measured in the
 * step zero at 192 ms at worst over docker/docs at full speed.
 */

/**
 * Files read in one check: the walk of the panel reads up to 2000 folders
 * (#746), and docker/docs content held 1121 markdown files in the step zero
 * of #766. Past it the report says so.
 */
export const MAX_FOLDER_FILES = 2000;

/**
 * Relative links found in one check before it stops reading files: the whole
 * census held 22504 in the step zero of #766, and 2000 files at the density of
 * docker/docs hold about 11000. Past it the report says so.
 */
export const MAX_FOLDER_LINKS = 20000;

/**
 * The largest file read, in bytes of UTF-8: 512 KB. Past it the file is not
 * parsed and is listed as not checked. In the step zero of #766 it left out 12
 * files of the census and their 501 relative links, and no file of
 * docker/docs; it keeps out the release notes of Rust, 884 KB, which took 5.3
 * s on the route a load takes in Chromium.
 */
export const MAX_FILE_BYTES = 512_000;

/** Why a whole file was not checked. */
export type FileSkip = 'too-large' | 'unread';

/** One file read by the check, with what was found, or why it was not read. */
export interface FileCheck {
  /** Absolute path of the file. */
  readonly path: string;
  readonly result: LinkCheckResult | null;
  readonly skipped?: FileSkip;
}

export interface FolderCheck {
  /** Each file read, in the order of the walk. */
  readonly files: readonly FileCheck[];
  /** How many files were read. */
  readonly read: number;
  /** How many the check set out to read: the markdown files, up to `MAX_FOLDER_FILES`. */
  readonly total: number;
  readonly stopped: boolean;
  /** The bound that ended the check before its last file, if one did. */
  readonly bound: 'files' | 'links' | null;
}

/** The open document, read from the editor rather than from the disk. */
export interface OpenDocument {
  readonly path: string;
  readonly doc: ProseMirrorNode;
}

export interface FolderCheckDeps {
  readonly io: PlatformIO;
  readonly schema: Schema;
  readonly openDocument: () => OpenDocument | null;
  /** After each file: how many have been read, of how many. */
  readonly progress: (read: number, total: number) => void;
  /** Whether the person pressed Stop; asked before each file. */
  readonly stopped: () => boolean;
}

/** The markdown files of a tree, as absolute paths, in the order of the walk. */
export function markdownFilesOf(root: string, files: readonly string[]): string[] {
  return files.map((file) => joinPath(root, file)).filter(isMarkdownPath);
}

/** Bytes of `text` in UTF-8, counted without encoding it. */
export function utf8Length(text: string): number {
  let bytes = 0;
  // Bounded by the length of the text, one pass.
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

type FileLinks = { readonly links: DocumentLink[] } | { readonly skipped: FileSkip };

/** The links of one file: from the editor for the open file, from the disk otherwise. */
async function linksOfFile(path: string, deps: FolderCheckDeps): Promise<FileLinks> {
  const open = deps.openDocument();
  if (open !== null && samePath(open.path, path)) return { links: collectLinks(open.doc) };
  let text: string;
  try {
    text = await deps.io.readText(path);
  } catch (e) {
    console.warn('[agented] a file of the folder could not be read:', path, e);
    return { skipped: 'unread' };
  }
  if (utf8Length(text) > MAX_FILE_BYTES) return { skipped: 'too-large' };
  try {
    const body = parseMarkdown(text, path).document.markdownBody;
    return { links: collectLinks(parseDocument(deps.schema, body)) };
  } catch (e) {
    // A file AgentEd would refuse to open (#455) is a file it could not read.
    console.warn('[agented] a file of the folder could not be taken in:', path, e);
    return { skipped: 'unread' };
  }
}

/** Check each of `files`, absolute paths of markdown files, within the bounds. */
export async function checkFolder(
  files: readonly string[],
  deps: FolderCheckDeps,
): Promise<FolderCheck> {
  const total = Math.min(files.length, MAX_FOLDER_FILES);
  const out: FileCheck[] = [];
  let relative = 0;
  let bound: FolderCheck['bound'] = files.length > MAX_FOLDER_FILES ? 'files' : null;
  // Bounded by `MAX_FOLDER_FILES`, one pass a file.
  for (const path of files.slice(0, total)) {
    if (deps.stopped()) return { files: out, read: out.length, total, stopped: true, bound: null };
    if (relative >= MAX_FOLDER_LINKS) {
      bound = 'links';
      break;
    }
    const found = await linksOfFile(path, deps);
    if ('skipped' in found) out.push({ path, result: null, skipped: found.skipped });
    else {
      relative += found.links.filter((link) => isRelativeLinkAddress(link.href)).length;
      out.push({ path, result: await checkLinks(path, found.links, deps.io) });
    }
    deps.progress(out.length, total);
  }
  return { files: out, read: out.length, total, stopped: false, bound };
}
