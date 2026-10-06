import { describe, expect, it } from 'vitest';
import packageLock from '../../package-lock.json?raw';
import {
  copyrightFromOverride,
  parseCargoTree,
  splitCopyright,
} from '../../src-tauri/notices/third-party-notices.mjs';
import notices from '../../src-tauri/THIRD-PARTY-NOTICES.txt?raw';
import tauriConf from '../../src-tauri/tauri.conf.json?raw';
import { THIRD_PARTY_NOTICES_FILE } from './index';

/**
 * #475: the licence notices ship with the installer, as a file beside the
 * executable, and About names it.
 *
 * Whether the file is current against the Rust graph is the `--check` step in
 * CI, since only `cargo tree` knows that graph. What the suite can see, it
 * pins here: that About names the file the bundle installs, that every
 * production npm package of the lockfile has its entry, and what the
 * generator lifts out of a licence text and what it leaves in.
 */
interface LockEntry {
  version?: string;
  dev?: boolean;
  optional?: boolean;
}

const entryHeads = new Set(notices.split('\n').filter((line) => /^\S+ \S/.test(line)));

describe('the notices file the installer ships', () => {
  it('is the resource the bundle installs, under the name About shows', () => {
    const resources: unknown = JSON.parse(tauriConf).bundle.resources;
    expect(resources).toEqual([THIRD_PARTY_NOTICES_FILE]);
  });

  it('lists every production package of package-lock.json at its version', () => {
    const packages: Record<string, LockEntry> = JSON.parse(packageLock).packages;
    const production = Object.entries(packages).filter(
      ([path, info]) => path.startsWith('node_modules/') && !info.dev && !info.optional,
    );
    expect(production.length).toBeGreaterThan(50);
    for (const [path, info] of production) {
      const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
      expect(entryHeads, `${name} ${info.version}`).toContain(`${name} ${info.version}`);
    }
  });

  it('carries the vendored search and replace with its own copyright line', () => {
    const entry = notices.slice(notices.indexOf('tiptap-search-and-replace vendored as'));
    expect(entry).toContain('Copyright (c) 2023 - 2024 Jeet Mandaliya');
  });

  it.each([
    [
      'Rust crates',
      (name: string, version: string) => `https://crates.io/crates/${name}/${version}`,
    ],
    [
      'npm packages',
      (name: string, version: string) => `https://www.npmjs.com/package/${name}/v/${version}`,
    ],
  ])(
    'names the source of every one of its %s under the Mozilla Public License',
    (title, source) => {
      // MPL-2.0, section 3.2 (a): a recipient of the executable form is told
      // how to obtain the source code form.
      const start = notices.indexOf(`\n${title} (`);
      const section = notices.slice(
        start,
        notices.indexOf('\n=====', notices.indexOf('\n', start + 80)),
      );
      const blocks = section
        .split('\n\n')
        .filter((block) => /\n {2}Licence: .*MPL-2\.0/.test(block));
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const [name, version] = block.split('\n')[0].split(' ');
        expect(block).toContain(`Source code: ${source(name, version)}`);
      }
    },
  );

  it('refers only to licence texts it holds', () => {
    const count = Number(/^Licence texts \((\d+)\)$/m.exec(notices)?.[1]);
    const refs = [...notices.matchAll(/^ {2}Licence texts?: (.+)$/gm)].flatMap((m) =>
      m[1].split(', ').map(Number),
    );
    expect(refs.length).toBeGreaterThan(300);
    for (const ref of refs) expect(ref >= 1 && ref <= count, `text ${ref}`).toBe(true);
  });
});

describe('what the generator lifts out of a licence text', () => {
  it('lifts the copyright lines of the head and keeps the rest of the text', () => {
    const mit = 'MIT License\n\nCopyright (c) 2015 A. Person\n\nPermission is hereby granted.';
    expect(splitCopyright(mit)).toEqual({
      copyright: ['Copyright (c) 2015 A. Person'],
      inner: false,
      text: 'MIT License\n\nPermission is hereby granted.',
    });
  });

  it('keeps a copyright line that belongs to the prose below the head', () => {
    // The musl notice `dpi` ships: each line ends in `or`, so lifting one
    // would break the sentence it is part of.
    const musl =
      'musl as a whole is licensed under the following standard MIT license:\n\nCopyright © 1993 Sun Microsystems or\nCopyright © 2003 David Schultz';
    const split = splitCopyright(musl);
    expect(split.copyright).toEqual([]);
    expect(split.inner).toBe(true);
    expect(split.text).toContain('Copyright © 1993 Sun Microsystems or');
  });

  it('does not take a sentence about copyright for a copyright line', () => {
    const apache =
      'Apache License\n\n(c) You must retain, in the Source form\ncopyright notice that is included\n(c) under Patent Claims';
    expect(splitCopyright(apache).copyright).toEqual([]);
  });

  it('drops the placeholder of a template and lifts an SPDX copyright field', () => {
    expect(splitCopyright('Copyright (c) <year> <copyright holders>\n\nText.').copyright).toEqual(
      [],
    );
    const spdx =
      'SPDXVersion: SPDX-2.1\nPackageSupplier: Organization: The Tauri Programme in the Commons\nPackageCopyrightText: 2019-2022, The Tauri Programme';
    expect(splitCopyright(spdx).copyright).toEqual([
      'PackageCopyrightText: 2019-2022, The Tauri Programme',
    ]);
  });

  it('reads crate names and versions out of cargo tree, the workspace crate left out', () => {
    const tree =
      'agented v0.2.0 (/repo/src-tauri)\nserde v1.0.228\nserde_derive v1.0.228 (proc-macro)\nserde v1.0.228 (*)\n';
    expect(parseCargoTree(tree)).toEqual([
      ['serde', '1.0.228'],
      ['serde_derive', '1.0.228'],
    ]);
  });
});

describe('a copyright line an override gives a package whose licence carries none (#492)', () => {
  const dompurify = {
    name: 'dompurify',
    version: '3.4.16',
    copyrightOverride: { version: '3.4.16', copyright: '(c) Cure53 and other contributors' },
  };

  it('is what the file lists for DOMPurify, whose licence files carry no copyright line', () => {
    const entry = notices.slice(
      notices.indexOf('\ndompurify '),
      notices.indexOf('\n\n', notices.indexOf('\ndompurify ') + 1),
    );
    expect(entry).toContain('(c) Cure53 and other contributors');
    // From 3.4.8 the MPL text is published beside the Apache one, so the
    // entry refers to both licences of its choice.
    expect(entry).toMatch(/Licence texts: \d+, \d+/);
  });

  it('is given when the licence file carries no copyright line', () => {
    expect(copyrightFromOverride(dompurify, [])).toEqual(['(c) Cure53 and other contributors']);
  });

  it('fails once the package moves past the version it was read from', () => {
    // No release from 3.4.5 to 3.4.16 publishes a copyright line, so at each
    // move the override is renewed rather than removed; the version makes
    // someone read the header again.
    expect(() => copyrightFromOverride({ ...dompurify, version: '3.4.17' }, [])).toThrow(
      /3\.4\.16, but 3\.4\.17 is installed/,
    );
  });

  it('fails once the licence file carries a copyright line of its own', () => {
    expect(() => copyrightFromOverride(dompurify, ['Copyright 2026 Cure53'])).toThrow(
      /now publishes a copyright line/,
    );
  });

  it('leaves a package without an override as it was', () => {
    expect(copyrightFromOverride({ name: 'marked', version: '15.0.12' }, ['x'])).toEqual(['x']);
  });
});
