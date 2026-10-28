// The npm half of the weekly advisory check of security.yml (#668).
//
// `npm audit` has no list of advisories to leave out, so this reads its JSON
// report and the list of accepted advisories in
// .github/npm-advisories-accepted.json, each with the reason the owner gave,
// and reports the rest. An advisory is named by the id at the end of its
// GitHub URL, GHSA-xxxx-xxxx-xxxx. A package npm reports only because it
// depends on another one carries no advisory of its own and is not counted.
//
// Run as: node npm-advisories.mjs <npm audit --json report> <accepted list>
// It prints one GitHub warning per advisory not accepted, and one per accepted
// advisory npm no longer reports, so a stale entry shows too. It exits 0 when
// it could read both files, whatever it found: the check reports and never
// blocks. It exits 1 when a file cannot be read, so a broken run is not
// mistaken for a clean one.
//
// Node built-ins only: no dependency is added for this.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The id at the end of an advisory URL, or the URL itself when it has none. */
function advisoryId(url) {
  const match = /\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/i.exec(url ?? '');
  return match ? match[1] : String(url);
}

/**
 * The advisories of an `npm audit --json` report, one entry per id, with the
 * packages it names. Bounded by the entries of the report.
 */
export function advisoriesOf(report) {
  const found = new Map();
  for (const entry of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const id = advisoryId(via.url);
      const known = found.get(id) ?? {
        id,
        title: via.title ?? '',
        severity: via.severity ?? '',
        url: via.url ?? '',
        packages: [],
      };
      if (!known.packages.includes(via.name)) known.packages.push(via.name);
      found.set(id, known);
    }
  }
  return [...found.values()];
}

/** What to report: the advisories not accepted, and the accepted ids no longer found. */
export function toReport(report, accepted) {
  const ids = new Set((accepted?.accepted ?? []).map((entry) => entry.id));
  const advisories = advisoriesOf(report);
  const found = new Set(advisories.map((advisory) => advisory.id));
  return {
    reported: advisories.filter((advisory) => !ids.has(advisory.id)),
    stale: [...ids].filter((id) => !found.has(id)),
    accepted: advisories.filter((advisory) => ids.has(advisory.id)).map((advisory) => advisory.id),
  };
}

function main([reportPath, acceptedPath]) {
  let report;
  let accepted;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
    accepted = JSON.parse(readFileSync(acceptedPath, 'utf8'));
  } catch (error) {
    console.log(`::error::The npm audit report or the accepted list could not be read: ${error}`);
    return 1;
  }
  const { reported, stale, accepted: kept } = toReport(report, accepted);
  for (const advisory of reported) {
    console.log(
      `::warning title=npm advisory ${advisory.id}::${advisory.severity}, ${advisory.packages.join(', ')}: ${advisory.title} ${advisory.url}`,
    );
  }
  for (const id of stale) {
    console.log(
      `::warning title=npm advisory ${id}::accepted in .github/npm-advisories-accepted.json, and npm audit no longer reports it; the entry can go.`,
    );
  }
  console.log(
    `npm advisories: ${reported.length} reported, ${kept.length} accepted (${kept.join(', ') || 'none'}), ${stale.length} accepted and no longer found.`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
