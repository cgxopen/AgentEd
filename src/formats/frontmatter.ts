import yaml from 'js-yaml';
import type { Profile } from '../profiles/types';
import type { DocumentBundle } from './types';

/** Reconstruct full markdown from frontmatter + body. */
export function assembleMarkdown(bundle: DocumentBundle): string {
  if (!bundle.frontmatterRaw) return bundle.markdownBody;
  return `---\n${bundle.frontmatterRaw}\n---\n${bundle.markdownBody}`;
}

/** Split frontmatter from markdown text. */
export function splitFrontmatter(text: string): { raw: string | null; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { raw: null, body: text };
  return { raw: match[1], body: match[2] };
}

/**
 * Inject default frontmatter when the active profile requires it and the
 * bundle has none. No-op if frontmatter is already present (even if some
 * required fields are missing — partial injection would risk losing
 * comments and field ordering, and validation surfaces missing fields).
 */
export function ensureFrontmatterForProfile(
  bundle: DocumentBundle,
  profile: Profile,
): DocumentBundle {
  if (profile.frontmatterRules.status !== 'required') return bundle;
  if (bundle.frontmatterRaw && bundle.frontmatterRaw.trim().length > 0) return bundle;

  const defaults = buildDefaultsObject(profile.frontmatterRules.defaults);
  if (Object.keys(defaults).length === 0) return bundle;

  const raw = yaml.dump(defaults, { quotingType: '"', forceQuotes: false }).trimEnd();
  return { ...bundle, frontmatterRaw: raw };
}

/**
 * Convert a flat dot-path map into a nested object suitable for YAML
 * dump. `{ "metadata.openclaw.version": "1.0.0" }` becomes
 * `{ metadata: { openclaw: { version: "1.0.0" } } }`.
 */
function buildDefaultsObject(defaults: Readonly<Record<string, string>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(defaults)) {
    setKeyPath(out, path, value);
  }
  return out;
}

function setKeyPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cur[key];
    if (next == null || typeof next !== 'object') {
      const fresh: Record<string, unknown> = {};
      cur[key] = fresh;
      cur = fresh;
    } else {
      cur = next as Record<string, unknown>;
    }
  }
  cur[parts[parts.length - 1]] = value;
}
