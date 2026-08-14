import type { DocumentBundle } from '../formats/types';
import { basename } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { detectProfile } from './index';
import type { ProfileId } from './types';
import { parseFrontmatterBlock } from './utils';

/**
 * Adapt a DocumentBundle into a DetectContext and run the registry's
 * detection pass. Adjacent directories are listed from the document's
 * companion folder (sibling layout: `<filename>/`; parent-as-folder:
 * the parent of `SKILL.md`); markdown documents have none.
 */
export async function detectProfileForBundle(
  bundle: DocumentBundle,
  io: PlatformIO,
): Promise<ProfileId> {
  const adjacentDirectories = await collectAdjacentDirectories(bundle, io);
  const result = detectProfile({
    filename: basename(bundle.rootPath),
    frontmatter: parseFrontmatterBlock(bundle.frontmatterRaw),
    body: bundle.markdownBody,
    adjacentDirectories,
  });
  return result.profileId;
}

async function collectAdjacentDirectories(
  bundle: DocumentBundle,
  io: PlatformIO,
): Promise<string[]> {
  if (!bundle.docFolder) return [];
  try {
    const entries = await io.listDir(bundle.docFolder);
    return entries.filter((e) => e.isDirectory).map((e) => e.name);
  } catch {
    return [];
  }
}
