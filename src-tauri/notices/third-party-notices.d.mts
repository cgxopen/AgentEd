// Types for the pure functions of third-party-notices.mjs, which the suite
// imports from src/platform/third-party-notices.test.ts.

export function splitCopyright(text: string): {
  copyright: string[];
  inner: boolean;
  text: string;
};

export function parseCargoTree(output: string): string[][];
