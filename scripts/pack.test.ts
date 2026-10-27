import type { PackedTarball } from './pack';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { distTag, exportTargets, packPackage, tarballProblems } from './pack';

const LEGAL = { license: 'Apache License text', notice: 'NOTICE text' };

function tarball(overrides: Partial<PackedTarball> = {}): PackedTarball {
  return {
    entries: ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/index.js', 'dist/index.d.ts'],
    manifest: {
      name: '@open-tomato/example',
      version: '1.0.0',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      dependencies: { '@open-tomato/service-logger': '^1.0.0' },
    },
    license: LEGAL.license,
    notice: LEGAL.notice,
    ...overrides,
  };
}

describe('tarballProblems', () => {
  test('passes a tarball with its root files, its build and real versions', () => {
    expect(tarballProblems(tarball(), LEGAL)).toEqual([]);
  });

  test('names a root file the tarball lacks', () => {
    const packed = tarball({ entries: ['package.json', 'README.md', 'NOTICE', 'dist/index.js', 'dist/index.d.ts'], license: '' });

    expect(tarballProblems(packed, LEGAL)).toContain('lacks LICENSE');
  });

  test('names a LICENSE or NOTICE that differs from the repository copy', () => {
    const packed = tarball({ license: 'MIT License', notice: 'other notice' });

    expect(tarballProblems(packed, LEGAL)).toEqual([
      'LICENSE differs from the repository root copy',
      'NOTICE differs from the repository root copy',
    ]);
  });

  test('names source maps, tests and files outside dist', () => {
    const packed = tarball({
      entries: [...tarball().entries, 'dist/index.js.map', 'dist/index.test.js', 'src/index.ts'],
    });

    expect(tarballProblems(packed, LEGAL)).toEqual([
      'ships a source map: dist/index.js.map',
      'ships a test: dist/index.test.js',
      'ships a file outside dist: src/index.ts',
    ]);
  });

  test('names an export target the tarball lacks', () => {
    const packed = tarball({ entries: ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/index.js'] });

    expect(tarballProblems(packed, LEGAL)).toEqual(['exports dist/index.d.ts, which the tarball lacks']);
  });

  test('names a dependency still on the workspace protocol', () => {
    const packed = tarball({
      manifest: { ...tarball().manifest, peerDependencies: { '@open-tomato/service': 'workspace:^' } },
    });

    expect(tarballProblems(packed, LEGAL)).toEqual(['peerDependencies @open-tomato/service is workspace:^']);
  });
});

describe('exportTargets', () => {
  test('collects every path of a nested conditions map, without the leading ./', () => {
    const exports = {
      '.': {
        browser: { types: './dist/browser.d.ts', default: './dist/browser.js' },
        types: './dist/node.d.ts',
        default: './dist/node.js',
      },
    };

    expect(exportTargets(exports)).toEqual(['dist/browser.d.ts', 'dist/browser.js', 'dist/node.d.ts', 'dist/node.js']);
  });
});

describe('distTag', () => {
  test('publishes a release as latest', () => {
    expect(distTag('1.0.0')).toBe('latest');
    expect(distTag('1.4.2+build.7')).toBe('latest');
  });

  test('publishes a prerelease as next, so it never becomes latest', () => {
    expect(distTag('2.0.0-next.1')).toBe('next');
  });
});

describe('packPackage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pack-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads back the entries, the manifest and the legal files of the packed tarball', () => {
    // Arrange
    const pkg = join(dir, 'pkg');
    mkdirSync(join(pkg, 'dist'), { recursive: true });
    // npm and bun pack LICENSE and README on their own; NOTICE only when `files` names it.
    const manifest = { name: 'pack-fixture', version: '1.2.3', files: ['dist', 'NOTICE'], exports: { '.': './dist/index.js' } };
    writeFileSync(join(pkg, 'package.json'), JSON.stringify(manifest));
    writeFileSync(join(pkg, 'README.md'), '# fixture\n');
    writeFileSync(join(pkg, 'LICENSE'), LEGAL.license);
    writeFileSync(join(pkg, 'NOTICE'), LEGAL.notice);
    writeFileSync(join(pkg, 'dist', 'index.js'), 'export const value = 1;\n');
    writeFileSync(join(pkg, 'notes.txt'), 'not in files');

    // Act
    const { path, packed } = packPackage(pkg, join(dir, 'out'));

    // Assert
    expect(path).toEndWith('.tgz');
    expect([...packed.entries].sort()).toEqual(['LICENSE', 'NOTICE', 'README.md', 'dist/index.js', 'package.json']);
    expect(packed.manifest.version).toBe('1.2.3');
    expect(packed.license).toBe(LEGAL.license);
    expect(packed.notice).toBe(LEGAL.notice);
  });
});
