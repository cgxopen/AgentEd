// Writes src-tauri/THIRD-PARTY-NOTICES.txt, the licence notices of what the
// Windows installer ships (#475), or with --check fails when that file is not
// what this script would write now.
//
// What is listed, by owner decision of 2026-10-05 on #475:
// - Rust: the normal dependency graph for x86_64-pc-windows-msvc, proc-macros
//   included, read from `cargo tree`; build and dev dependencies carry none.
// - npm: the production packages of package-lock.json, whether or not the
//   bundler kept them; a notice too many costs bytes, one too few costs the
//   licence.
// - The vendored source under src/editor/vendor.
//
// Every package keeps its own entry: name, version, licence and copyright
// line. Licence texts are written once each, with their copyright lines lifted
// into the entries that carry them, and the entries refer to them by number.
//
// Node built-ins only: no dependency is added to produce this file.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAURI = join(HERE, '..');
const ROOT = join(TAURI, '..');
const OUTPUT = join(TAURI, 'THIRD-PARTY-NOTICES.txt');
const TARGET = 'x86_64-pc-windows-msvc';
const VENDORED = 'src/editor/vendor/search-and-replace.ts';

// Bounds, so that a malformed input fails rather than runs away.
const MAX_PACKAGES = 2000;
const MAX_LICENCE_BYTES = 256 * 1024;
const MAX_COPYRIGHT_LINES = 20;

const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;
// A copyright line: `Copyright` that is not the start of a sentence about
// copyright (`copyright notice`, `COPYRIGHT HOLDERS BE LIABLE`), a `©`, or a
// `(c)` before a year, or the SPDX `PackageCopyrightText:` field. Licence bodies hold all three shapes otherwise: the
// Apache text has `(c) You must retain` and the MPL `(c) under Patent Claims`.
const COPYRIGHT =
  /^\s*(?:copyright\b(?!\s+(?:notice|licen[cs]e|owner|holders?|and|law|statement|claim|protection|terms|or\b|in\b|to\b))|©|\(c\)\s*\d|packagecopyrighttext:)/i;
const MAX_COPYRIGHT_LENGTH = 200;
const MAX_TITLE_LENGTH = 60;
const SPDX_COPYRIGHT = /^\s*PackageCopyrightText:/;
// The placeholder lines of template texts, which name no one.
const PLACEHOLDER = /[<[{](yyyy|year|name of copyright owner|copyright holders|owner)[>\]}]/i;

function fail(message) {
  throw new Error(`third-party-notices: ${message}`);
}

function readText(path) {
  if (statSync(path).size > MAX_LICENCE_BYTES) fail(`${path} is larger than the bound`);
  return readFileSync(path, 'utf8');
}

/** Line endings and trailing spaces normalised, so two copies of a text compare equal. */
function normalise(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/** A short line of the head that is not a sentence: `MIT License`, `COPYRIGHT AND PERMISSION NOTICE`. */
function isTitle(line) {
  return line.length <= MAX_TITLE_LENGTH && !/[.:]$/.test(line) && !COPYRIGHT.test(line);
}

/**
 * Splits a licence text into the copyright lines of its head and the text
 * without them. Only the head is read: blank lines, titles, copyright lines
 * and the `All rights reserved.` that follows one, up to the first line of
 * prose. A copyright line further down belongs to the prose around it, as in
 * the musl notice `dpi` ships, where each line ends in `or`, and lifting it
 * would break the sentence; it stays in the text.
 */
export function splitCopyright(text) {
  const lines = normalise(text).split('\n');
  const copyright = [];
  let head = 0;
  for (; head < lines.length; head += 1) {
    const line = lines[head].trim();
    if (COPYRIGHT.test(line) && line.length <= MAX_COPYRIGHT_LENGTH) {
      if (!PLACEHOLDER.test(line)) copyright.push(line);
    } else if (/^all rights reserved\.?$/i.test(line) && copyright.length > 0) {
      copyright[copyright.length - 1] += ` ${line}`;
    } else if (line !== '' && !isTitle(line)) {
      break;
    }
  }
  const titles = lines.slice(0, head).filter((line) => line.trim() !== '' && isTitle(line.trim()));
  // An SPDX document states its copyright as a field, wherever the field
  // sits; a field is not prose, so it is lifted from anywhere.
  const rest = lines.slice(head).filter((line) => {
    if (!SPDX_COPYRIGHT.test(line)) return true;
    copyright.push(line.trim());
    return false;
  });
  const body = [...titles, '', ...rest].join('\n');
  const inner = rest.some((line) => COPYRIGHT.test(line.trim()) && !PLACEHOLDER.test(line));
  return { copyright, inner, text: normalise(body) };
}

function licenceFiles(dir) {
  return readdirSync(dir)
    .filter((name) => LICENCE_FILE.test(name) && statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => readText(join(dir, name)));
}

function standardText(id) {
  return readText(join(HERE, 'texts', `${id}.txt`));
}

/** The crate names and versions `cargo tree` prints, the workspace crate left out. */
export function parseCargoTree(output) {
  const seen = new Set();
  for (const line of output.split('\n')) {
    const match = /^(\S+) v(\S+)/.exec(line.trim());
    if (match && match[1] !== 'agented') seen.add(`${match[1]} ${match[2]}`);
  }
  if (seen.size > MAX_PACKAGES) fail('more crates than the bound');
  return [...seen].map((key) => key.split(' '));
}

function cargo(args) {
  return execFileSync('cargo', args, {
    cwd: TAURI,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function rustPackages(overrides) {
  const tree = cargo([
    'tree',
    '--locked',
    '-q',
    '-e',
    'normal',
    '--target',
    TARGET,
    '--prefix',
    'none',
  ]);
  const metadata = JSON.parse(cargo(['metadata', '--locked', '--format-version', '1']));
  const byKey = new Map(metadata.packages.map((p) => [`${p.name} ${p.version}`, p]));
  return parseCargoTree(tree).map(([name, version]) => {
    const meta = byKey.get(`${name} ${version}`);
    if (!meta) fail(`cargo metadata has no ${name} ${version}`);
    const entry = {
      kind: 'crate',
      name,
      version,
      licence: meta.license ?? meta.license_file ?? 'none declared',
      files: licenceFiles(dirname(meta.manifest_path)),
      authors: meta.authors ?? [],
      override: overrides.crates[name],
    };
    if (/MPL-2\.0/.test(entry.licence)) {
      // MPL-2.0, section 3.2 (a): a recipient of the executable form must be
      // told how to obtain the source code form of the covered files.
      entry.source = `https://crates.io/crates/${name}/${version}`;
    }
    return entry;
  });
}

function npmPackages(overrides) {
  const lock = JSON.parse(readText(join(ROOT, 'package-lock.json')));
  const entries = [];
  for (const [path, info] of Object.entries(lock.packages)) {
    // `devOptional` stays in: a production install (`npm ci --omit=dev`) keeps it.
    if (!path.startsWith('node_modules/') || info.dev || info.optional) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const dir = join(ROOT, path);
    const scope = Object.keys(overrides.npmScopes).find((prefix) => name.startsWith(prefix));
    const entry = {
      kind: 'npm',
      name,
      version: info.version,
      licence: info.license ?? 'none declared',
      files: licenceFiles(dir),
      authors: [],
      override: scope ? overrides.npmScopes[scope] : undefined,
      copyrightOverride: overrides.npmCopyright[name],
    };
    if (/MPL-2\.0/.test(entry.licence)) {
      // As for the crates, MPL-2.0 section 3.2 (a); where the MPL is one
      // licence of a choice, the line costs nothing and is still true.
      entry.source = `https://www.npmjs.com/package/${name}/v/${info.version}`;
    }
    entries.push(entry);
  }
  if (entries.length > MAX_PACKAGES) fail('more npm packages than the bound');
  return entries;
}

function vendoredPackage() {
  // The licence block of the header: from `// MIT License` to the first import.
  const lines = normalise(readText(join(ROOT, VENDORED))).split('\n');
  const start = lines.indexOf('// MIT License');
  const end = lines.findIndex((line) => line.startsWith('import '));
  if (start < 0 || end < start) fail(`${VENDORED} no longer opens with its MIT licence block`);
  const licence = lines.slice(start, end).map((line) => line.replace(/^\/\/ ?/, ''));
  return {
    kind: 'vendored',
    name: 'tiptap-search-and-replace',
    version: `vendored as ${VENDORED}`,
    licence: 'MIT',
    files: [licence.join('\n')],
    authors: [],
  };
}

/**
 * The copyright line an override gives a package whose licence file carries
 * none (#492): DOMPurify 3.4.5 and later publish the Apache text alone, with
 * the copyright only in the `@license` header of their code, which the bundle
 * drops. The override names the exact version it was read from, so that any
 * update fails here and the header is read again, and it fails as well once
 * the licence file carries a copyright line of its own.
 */
export function copyrightFromOverride(pkg, lines) {
  const override = pkg.copyrightOverride;
  if (!override) return lines;
  if (override.version !== pkg.version) {
    fail(
      `overrides.json gives the copyright of ${pkg.name} ${override.version}, but ${pkg.version} is installed: read its licence and @license header again`,
    );
  }
  if (lines.length > 0) {
    fail(
      `${pkg.name} ${pkg.version} now publishes a copyright line: remove its entry from overrides.json`,
    );
  }
  return [override.copyright];
}

/** Each package's copyright lines and the numbers of its texts; texts numbered by first use. */
export function assemble(packages) {
  const texts = [];
  const numberOf = new Map();
  const entries = packages.map((pkg) => {
    const sources = pkg.files;
    if (sources.length === 0 && !pkg.override) {
      fail(
        `${pkg.name} ${pkg.version} publishes no licence file and has no entry in overrides.json`,
      );
    }
    const copyright = [];
    const ids = [];
    let inner = false;
    const bodies = sources.length > 0 ? sources : pkg.override.texts.map(standardText);
    for (const body of bodies) {
      const split = splitCopyright(body);
      copyright.push(...split.copyright);
      inner ||= split.inner;
      if (split.text === '') continue;
      if (!numberOf.has(split.text)) {
        texts.push(split.text);
        numberOf.set(split.text, texts.length);
      }
      ids.push(numberOf.get(split.text));
    }
    if (pkg.override && sources.length === 0) copyright.unshift(pkg.override.copyright);
    const unique = copyrightFromOverride(
      pkg,
      [...new Set(copyright)].slice(0, MAX_COPYRIGHT_LINES),
    );
    if (unique.length === 0 && pkg.authors.length > 0) {
      unique.push(`The ${pkg.name} authors: ${pkg.authors.join(', ')}`);
    }
    return { ...pkg, copyright: unique, inner, ids: [...new Set(ids)] };
  });
  return { entries, texts };
}

function byName(a, b) {
  return a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name);
}

function renderEntry(entry) {
  const lines = [`${entry.name} ${entry.version}`, `  Licence: ${entry.licence}`];
  for (const line of entry.copyright) lines.push(`  ${line}`);
  if (entry.inner) lines.push('  Further copyright lines: in its licence text below');
  if (entry.copyright.length === 0 && !entry.inner) lines.push('  No copyright line published');
  if (entry.source) lines.push(`  Source code: ${entry.source}`);
  const label = entry.ids.length > 1 ? 'Licence texts' : 'Licence text';
  lines.push(`  ${label}: ${entry.ids.length > 0 ? entry.ids.join(', ') : 'none published'}`);
  return lines.join('\n');
}

export function render({ entries, texts }) {
  const groups = [
    ['Rust crates', entries.filter((e) => e.kind === 'crate')],
    ['npm packages', entries.filter((e) => e.kind === 'npm')],
    ['Vendored source', entries.filter((e) => e.kind === 'vendored')],
  ];
  const parts = [
    'THIRD-PARTY NOTICES',
    'AgentEd includes the third-party software listed below. Each entry names the package, its version, its licence and its copyright notice, and refers by number to the licence texts that follow the list, each written once. For software under the Mozilla Public License 2.0, the entry names where its source code can be obtained.',
    `Generated by src-tauri/notices/third-party-notices.mjs from Cargo.lock (the normal dependency graph for ${TARGET}) and package-lock.json (the production packages). Do not edit by hand: run npm run notices.`,
  ];
  for (const [title, list] of groups) {
    parts.push(`${'='.repeat(72)}\n${title} (${list.length})\n${'='.repeat(72)}`);
    parts.push(...list.map(renderEntry));
  }
  parts.push(`${'='.repeat(72)}\nLicence texts (${texts.length})\n${'='.repeat(72)}`);
  texts.forEach((text, index) => {
    parts.push(`${'-'.repeat(72)}\nLicence text ${index + 1}\n${'-'.repeat(72)}\n\n${text}`);
  });
  return `${parts.join('\n\n')}\n`;
}

function checkOverrides(overrides, packages) {
  for (const name of Object.keys(overrides.crates)) {
    if (!packages.some((p) => p.kind === 'crate' && p.name === name)) {
      fail(`overrides.json names ${name}, which is not a shipped crate`);
    }
  }
  for (const name of Object.keys(overrides.npmCopyright)) {
    if (!packages.some((p) => p.kind === 'npm' && p.name === name)) {
      fail(`overrides.json gives a copyright for ${name}, which is not a production npm package`);
    }
  }
  for (const prefix of Object.keys(overrides.npmScopes)) {
    if (!packages.some((p) => p.kind === 'npm' && p.name.startsWith(prefix))) {
      fail(`overrides.json names ${prefix}, which matches no production npm package`);
    }
  }
}

function main() {
  const overrides = JSON.parse(readText(join(HERE, 'overrides.json')));
  // In the order the file lists them, so that texts are numbered as they are first met.
  const packages = [
    ...rustPackages(overrides).sort(byName),
    ...npmPackages(overrides).sort(byName),
    vendoredPackage(),
  ];
  checkOverrides(overrides, packages);
  const text = render(assemble(packages));
  const target = relative(ROOT, OUTPUT);
  if (process.argv.includes('--check')) {
    // A Windows checkout may hold the file with CRLF; the bytes that matter are the text.
    const current = readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n');
    if (current !== text) {
      console.error(`${target} is stale: a lockfile or a licence changed. Run npm run notices.`);
      process.exit(1);
    }
    console.log(`${target} is current.`);
    return;
  }
  writeFileSync(OUTPUT, text);
  console.log(`Wrote ${target}: ${packages.length} packages, ${Buffer.byteLength(text)} bytes.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
