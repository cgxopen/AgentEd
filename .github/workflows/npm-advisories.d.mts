// Types for the pure functions of npm-advisories.mjs, which ci.test.ts imports.

export interface Advisory {
  id: string;
  title: string;
  severity: string;
  url: string;
  packages: string[];
}

export function advisoriesOf(report: unknown): Advisory[];

export function toReport(
  report: unknown,
  accepted: unknown,
): { reported: Advisory[]; stale: string[]; accepted: string[] };
