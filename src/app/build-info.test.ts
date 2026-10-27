import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json?raw';
import cargoToml from '../../src-tauri/Cargo.toml?raw';
import tauriConf from '../../src-tauri/tauri.conf.json?raw';
import { BUILD_INFO, describeBuildInfo, formatBuildInfo, readBuildInfo } from './build-info';

describe('readBuildInfo', () => {
  it('keeps a commit that came from CI', () => {
    const info = readBuildInfo('0.2.0', 'a1b2c3d');
    expect(info).toEqual({ version: '0.2.0', commit: 'a1b2c3d', fromCi: true });
  });

  it('reports a local build when no commit was baked in', () => {
    expect(readBuildInfo('0.2.0', 'dev').fromCi).toBe(false);
  });

  it('treats an empty commit as a local build rather than showing a blank', () => {
    const info = readBuildInfo('0.2.0', '   ');
    expect(info.commit).toBe('dev');
    expect(info.fromCi).toBe(false);
  });

  it('never leaves the version blank', () => {
    expect(readBuildInfo('', 'a1b2c3d').version).toBe('unknown');
  });
});

describe('formatBuildInfo — the line that goes into a bug report', () => {
  it('names version and commit for a CI build', () => {
    expect(formatBuildInfo(readBuildInfo('0.2.0', 'a1b2c3d'))).toBe('AgentEd 0.2.0 (a1b2c3d)');
  });

  it('says plainly that a local build has no commit, rather than inventing one', () => {
    expect(formatBuildInfo(readBuildInfo('0.2.0', 'dev'))).toBe(
      'AgentEd 0.2.0 (local development build)',
    );
  });
});

describe('describeBuildInfo — what the dialog shows', () => {
  it('puts the version and the build on their own lines', () => {
    expect(describeBuildInfo(readBuildInfo('0.2.0', 'a1b2c3d'))).toBe(
      'Version 0.2.0\nBuild a1b2c3d',
    );
  });

  it('marks a local build as not coming from CI', () => {
    expect(describeBuildInfo(readBuildInfo('0.2.0', 'dev'))).toContain('not from CI');
  });
});

// Guards the plumbing rather than the values: if Vite's `define` stopped
// substituting, the module would not even evaluate. The commit is asserted by
// shape because it is genuinely different here and on a CI runner, where
// GITHUB_SHA is set — pinning either value would make this test a liar
// somewhere.
describe('BUILD_INFO — the values Vite baked in', () => {
  it('carries the package version', () => {
    expect(BUILD_INFO.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('carries either a short commit or the honest dev placeholder', () => {
    expect(BUILD_INFO.commit).toMatch(/^([0-9a-f]{7}|dev)$/);
  });

  it('agrees with itself about where it came from', () => {
    expect(BUILD_INFO.fromCi).toBe(BUILD_INFO.commit !== 'dev');
  });
});

/**
 * The version lives in three files, each read by a different consumer (#655):
 * About reads `package.json` through `vite.config.ts`, the installer file name
 * reads `tauri.conf.json`, and the crate reads `Cargo.toml`. A bump that moves
 * one of them alone ships a build whose About, installer and binary disagree.
 */
describe('the version, in the three files that carry it (#655)', () => {
  it('is the same in package.json, tauri.conf.json and Cargo.toml', () => {
    const cargo = /^\[package\][^[]*?^version = "([^"]+)"$/m.exec(cargoToml);
    expect({
      'tauri.conf.json': JSON.parse(tauriConf).version,
      'Cargo.toml': cargo?.[1],
    }).toEqual({
      'tauri.conf.json': JSON.parse(packageJson).version,
      'Cargo.toml': JSON.parse(packageJson).version,
    });
  });
});
