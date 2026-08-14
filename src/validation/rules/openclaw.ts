import yaml from 'js-yaml';
import type { ParsedFrontmatter, ValidationIssue } from '../types';

const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;

/**
 * OpenClaw-specific validation rules (R-OC-1..9).
 *
 * Runs only for AgentSkill documents that declare OpenClaw metadata
 * (`metadata.openclaw`, or legacy aliases `metadata.clawdbot` / `.clawdis`).
 * Exception: R-OC-9 fires even without OpenClaw metadata selected —
 * the alias conflict itself is the actionable signal, so we report it
 * even on skills that don't (yet) claim OpenClaw targeting.
 *
 * The rules look at both the parsed frontmatter object (via js-yaml on
 * `fm.raw`) and the markdown body — nested `metadata.openclaw.*` values
 * don't fit in the flat ParsedFrontmatter shape.
 */
export function validateOpenClaw(fm: ParsedFrontmatter, body: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parsed = parseFrontmatterObject(fm.raw);
  if (!parsed) return issues;

  const meta = (parsed.metadata ?? {}) as Record<string, unknown>;
  const aliasKeys = ['openclaw', 'clawdbot', 'clawdis'].filter((k) => meta[k]);

  // R-OC-9: multiple metadata aliases (fires even without OpenClaw
  // metadata selected — the conflict is the signal).
  if (aliasKeys.length > 1) {
    issues.push({
      ruleId: 'R-OC-9',
      severity: 'warning',
      line: 0,
      message: `Multiple metadata aliases defined: ${aliasKeys.join(', ')}. Prefer one (openclaw is canonical).`,
    });
  }

  const ocMeta = (meta.openclaw ?? meta.clawdbot ?? meta.clawdis) as
    | Record<string, unknown>
    | undefined;

  // Gate R-OC-1..R-OC-8 on the presence of OpenClaw metadata. Without
  // this, any skill with a benign `metadata:` key (e.g. `author`) would
  // trigger R-OC-1 and R-OC-2 as false positives. R-OC-9 is the only
  // rule that fires independently of this gate — the alias conflict is
  // itself the actionable signal and was already handled above.
  if (!ocMeta) return issues;

  // R-OC-1: multi-line YAML form (info until M3 ships the embedded/nested mode toggle).
  if (/^(metadata|requires|install)\s*:\s*$/m.test(fm.raw ?? '')) {
    issues.push({
      ruleId: 'R-OC-1',
      severity: 'info',
      line: 0,
      message:
        'Frontmatter uses multi-line YAML. If publishing for OpenClaw embedded parser, compact to single-line form.',
    });
  }

  // R-OC-2: same heuristic, downgraded to info — placeholder until the
  // embedded/nested mode toggle exists (deferred to M3).
  if (hasNestedMetadata(parsed)) {
    issues.push({
      ruleId: 'R-OC-2',
      severity: 'info',
      line: 0,
      message:
        'metadata is nested YAML. Single-line JSON form is required by some embedded OpenClaw parsers.',
    });
  }

  // R-OC-3: inaccessible skill — both model and user invocation disabled.
  if (parsed['disable-model-invocation'] === true && parsed['user-invocable'] === false) {
    issues.push({
      ruleId: 'R-OC-3',
      severity: 'warning',
      line: 0,
      message: 'Skill is inaccessible: disable-model-invocation=true AND user-invocable=false',
    });
  }

  // R-OC-4: command-dispatch requires command-tool.
  if (parsed['command-dispatch'] === true && !parsed['command-tool']) {
    issues.push({
      ruleId: 'R-OC-4',
      severity: 'error',
      line: 0,
      message: 'command-dispatch: true requires command-tool field',
    });
  }

  // R-OC-5: skillKey must match name (proxy — folder name isn't available here).
  const skillKey = ocMeta.skillKey;
  if (typeof skillKey === 'string' && typeof fm.name === 'string' && skillKey !== fm.name) {
    issues.push({
      ruleId: 'R-OC-5',
      severity: 'error',
      line: 0,
      message: `metadata.openclaw.skillKey (${skillKey}) must match name (${fm.name})`,
    });
  }

  // R-OC-6: declared deps without docs section.
  const requires = (ocMeta.requires ?? {}) as Record<string, unknown>;
  const requiresBins = (requires.bins ?? []) as unknown[];
  const requiresEnv = (requires.env ?? []) as unknown[];
  if (
    (requiresBins.length > 0 || requiresEnv.length > 0) &&
    !/^#{1,4}\s+(dependencies|requirements|runtime|installation)/im.test(body)
  ) {
    issues.push({
      ruleId: 'R-OC-6',
      severity: 'info',
      line: 0,
      message:
        'Runtime dependencies declared but no "Dependencies"/"Requirements"/"Runtime" section in body',
    });
  }

  // R-OC-7: env referenced in shell/python blocks but not declared.
  const declaredEnv = new Set(requiresEnv.filter((x): x is string => typeof x === 'string'));
  const scriptBlocks = extractScriptCodeBlocks(body);
  const envReferences = findEnvReferences(scriptBlocks);
  for (const envRef of envReferences) {
    if (!declaredEnv.has(envRef)) {
      issues.push({
        ruleId: 'R-OC-7',
        severity: 'warning',
        line: 0,
        message: `Env var ${envRef} referenced in scripts but not declared in metadata.openclaw.requires.env`,
      });
    }
  }

  // R-OC-8: semver check.
  const version = parsed.version;
  if (typeof version === 'string' && !SEMVER_RE.test(version)) {
    issues.push({
      ruleId: 'R-OC-8',
      severity: 'warning',
      line: 0,
      message: `version "${version}" is not valid semver (expected x.y.z)`,
    });
  }

  return issues;
}

function parseFrontmatterObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const obj = yaml.load(raw);
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hasNestedMetadata(parsed: Record<string, unknown>): boolean {
  const meta = parsed.metadata;
  if (!meta || typeof meta !== 'object') return false;
  // Nested if any top-level child of metadata is itself an object.
  return Object.values(meta as Record<string, unknown>).some(
    (v) => v !== null && typeof v === 'object',
  );
}

function extractScriptCodeBlocks(body: string): string[] {
  const blocks: string[] = [];
  const re = /```(?:bash|sh|python|py)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) blocks.push(m[1]);
  return blocks;
}

function findEnvReferences(blocks: string[]): Set<string> {
  const refs = new Set<string>();
  const shellRe = /\$\{?([A-Z][A-Z0-9_]+)\}?/g;
  const pyRe = /os\.(?:getenv|environ\[?)\s*\(?\s*['"]([A-Z][A-Z0-9_]+)['"]/g;
  for (const block of blocks) {
    let m: RegExpExecArray | null;
    while ((m = shellRe.exec(block)) !== null) refs.add(m[1]);
    while ((m = pyRe.exec(block)) !== null) refs.add(m[1]);
  }
  return refs;
}
