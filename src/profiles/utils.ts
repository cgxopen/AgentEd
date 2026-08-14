import yaml from 'js-yaml';

/** Parse a YAML frontmatter block into a plain object. Best-effort. */
export function parseFrontmatterBlock(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const obj = yaml.load(raw);
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** True if the dot-path resolves to a non-null value. */
export function hasKeyPath(obj: Record<string, unknown> | null, path: string): boolean {
  if (!obj) return false;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return false;
    const record = cur as Record<string, unknown>;
    if (!(part in record)) return false;
    cur = record[part];
  }
  return cur != null;
}

/** Resolve a dot-path; returns undefined if any segment is missing. */
export function getKeyPath(obj: Record<string, unknown> | null, path: string): unknown {
  if (!obj) return undefined;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
