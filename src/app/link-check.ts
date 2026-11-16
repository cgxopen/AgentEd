import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { isRelativeLinkAddress } from '../editor/link-url';
import { type LinkRefusal, resolveLinkTarget } from '../platform/link-target';
import type { EntryPresence, PlatformIO } from '../platform/types';
import { establishedPresence } from './entry-absence';

/**
 * The broken link check of the open document (#729): which of its relative
 * links name a file that is not there. It reports and repairs nothing, and
 * writes nothing.
 *
 * **One resolver.** Each address is read by `resolveLinkTarget`, the function
 * a Ctrl+click follows (#727), so the check and the click cannot answer
 * differently about one link. Every refusal of it is a reason the link was not
 * checked, never a broken link.
 *
 * **Web addresses are never looked at**: an address that is not relative is
 * left out before the resolver is asked, and no presence is asked for it, since
 * looking would be a network request (Q3).
 *
 * **Unknown is never broken.** A target whose presence was not established is
 * listed as not checked; absent is said only where the disk was seen not to
 * hold the file (`establishedPresence`).
 *
 * The links are read from the nodes of the document, not from its text: a link
 * is a run of inline content under one link mark, which is what the editor
 * draws as one link and what a click follows.
 */

/** A link of the document, in document order. */
export interface DocumentLink {
  readonly href: string;
  /** Where it starts and ends in the document, when it was read. */
  readonly from: number;
  readonly to: number;
  /** Its text as drawn; an image inside a link gives its description. */
  readonly text: string;
  /** How many links before it hold the same address: finds it again after edits. */
  readonly occurrence: number;
}

/** Why a relative link was not checked. */
export type NotCheckedReason =
  | Exclude<LinkRefusal, 'not-relative'>
  /** Its presence could not be established: a shut folder, no folder granted. */
  | 'unknown'
  /** Past the number of links one check looks at. */
  | 'too-many';

export interface BrokenLink {
  readonly link: DocumentLink;
  /** The path the resolver gave, which is not there. */
  readonly path: string;
}

export interface UncheckedLink {
  readonly link: DocumentLink;
  readonly reason: NotCheckedReason;
}

export interface LinkCheckResult {
  readonly broken: readonly BrokenLink[];
  readonly notChecked: readonly UncheckedLink[];
  /** Relative links whose target is there. */
  readonly good: number;
}

/**
 * More links than one check looks at; the rest are listed as not checked.
 * A thousand links were measured on #729; this is five times that.
 */
export const MAX_CHECKED_LINKS = 5000;

/** Presence questions in flight at once, so a thousand links are not a thousand calls at once. */
const PRESENCE_AT_ONCE = 16;

/** The links of `doc`, in document order, each run under one link mark counted once. */
export function collectLinks(doc: ProseMirrorNode): DocumentLink[] {
  const links: DocumentLink[] = [];
  const seen = new Map<string, number>();
  let open: { mark: Mark; end: number; index: number } | null = null;
  // Bounded by the nodes of the document, each visited once.
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    const mark = node.marks.find((m) => m.type.name === 'link');
    if (!mark || typeof mark.attrs.href !== 'string') {
      open = null;
      return false;
    }
    const text = node.isText ? (node.text ?? '') : String(node.attrs.alt ?? '');
    if (open !== null && open.end === pos && open.mark.eq(mark)) {
      const index = open.index;
      links[index] = { ...links[index], text: links[index].text + text, to: pos + node.nodeSize };
      open = { mark, end: pos + node.nodeSize, index };
      return false;
    }
    const href = mark.attrs.href;
    const occurrence = seen.get(href) ?? 0;
    seen.set(href, occurrence + 1);
    links.push({ href, from: pos, to: pos + node.nodeSize, text, occurrence });
    open = { mark, end: pos + node.nodeSize, index: links.length - 1 };
    return false;
  });
  return links;
}

/**
 * Check `links` of the document at `documentPath`. Each distinct target is
 * asked for once; nothing is written.
 */
export async function checkLinks(
  documentPath: string | null,
  links: readonly DocumentLink[],
  io: PlatformIO,
): Promise<LinkCheckResult> {
  const notChecked: UncheckedLink[] = [];
  const files: Array<{ link: DocumentLink; path: string }> = [];
  for (const link of links) {
    if (!isRelativeLinkAddress(link.href)) continue;
    if (files.length + notChecked.length >= MAX_CHECKED_LINKS) {
      notChecked.push({ link, reason: 'too-many' });
      continue;
    }
    const target = resolveLinkTarget(documentPath, link.href);
    if (target.kind === 'file') files.push({ link, path: target.path });
    else if (target.reason !== 'not-relative') notChecked.push({ link, reason: target.reason });
  }

  const presence = await presenceOfEach(
    io,
    files.map((f) => f.path),
  );
  const broken: BrokenLink[] = [];
  let good = 0;
  for (const file of files) {
    const answer = presence.get(file.path);
    if (answer === 'present') good += 1;
    else if (answer === 'absent') broken.push(file);
    else notChecked.push({ link: file.link, reason: 'unknown' });
  }
  notChecked.sort((a, b) => a.link.from - b.link.from);
  return { broken, notChecked, good };
}

async function presenceOfEach(
  io: PlatformIO,
  paths: readonly string[],
): Promise<Map<string, EntryPresence>> {
  const distinct = [...new Set(paths)];
  const answers = new Map<string, EntryPresence>();
  const listings = new Map<string, Promise<ReadonlySet<string> | null>>();
  // Bounded by the distinct targets, taken PRESENCE_AT_ONCE at a time.
  for (let start = 0; start < distinct.length; start += PRESENCE_AT_ONCE) {
    const batch = distinct.slice(start, start + PRESENCE_AT_ONCE);
    const results = await Promise.all(
      batch.map((path) =>
        establishedPresence(io, path, listings).catch((e: unknown) => {
          // `entryPresence` never rejects (#126); a listing that does is
          // already answered unknown. Anything else is told and stays unknown.
          console.warn('[agented] could not check a link target:', path, e);
          return 'unknown' as const;
        }),
      ),
    );
    for (let i = 0; i < batch.length; i += 1) answers.set(batch[i], results[i]);
  }
  return answers;
}
