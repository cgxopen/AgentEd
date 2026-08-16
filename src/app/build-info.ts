/**
 * Which build is this? (#31)
 *
 * A defect was once "reproduced" on an installer that predated its fix, and
 * nothing inside the app could tell which build was running. The installer
 * artifact carries the commit in its name, but that name is gone once the
 * thing is installed — so the build says who it is from the inside too.
 *
 * The values are baked in by Vite's `define` (see vite.config.ts); this module
 * only decides how they read.
 */

export interface BuildInfo {
  readonly version: string;
  /** Short commit the build came from, or `dev` outside CI. */
  readonly commit: string;
  /** False when no build commit was available — a local developer build. */
  readonly fromCi: boolean;
}

export const DEV_COMMIT = 'dev';

export function readBuildInfo(version: string, commit: string): BuildInfo {
  const trimmedCommit = commit.trim();
  const known = trimmedCommit !== '' && trimmedCommit !== DEV_COMMIT;
  return {
    version: version.trim() || 'unknown',
    commit: known ? trimmedCommit : DEV_COMMIT,
    fromCi: known,
  };
}

/** One line, made to be pasted into a bug report. */
export function formatBuildInfo(info: BuildInfo): string {
  return info.fromCi
    ? `AgentEd ${info.version} (${info.commit})`
    : `AgentEd ${info.version} (local development build)`;
}

/** How the About dialog spells it out: one fact per line. */
export function describeBuildInfo(info: BuildInfo): string {
  const build = info.fromCi
    ? `Build ${info.commit}`
    : 'Build: local development build (not from CI)';
  return `Version ${info.version}\n${build}`;
}

export const BUILD_INFO: BuildInfo = readBuildInfo(__APP_VERSION__, __BUILD_COMMIT__);
