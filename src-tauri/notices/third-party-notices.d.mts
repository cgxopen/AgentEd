// Types for the pure functions of third-party-notices.mjs, which the suite
// imports from src/platform/third-party-notices.test.ts.

export function splitCopyright(text: string): {
  copyright: string[];
  inner: boolean;
  text: string;
};

export function parseCargoTree(output: string): string[][];

export function copyrightFromOverride(
  pkg: {
    name: string;
    version: string;
    copyrightOverride?: { version: string; copyright: string };
  },
  lines: string[],
): string[];
