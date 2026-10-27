/**
 * Pack check: packs each public package with `bun pm pack`, the step that
 * writes real versions over `workspace:^`, then reads the tarball back and
 * checks what it would ship. It prints one line per package and exits 1
 * when any tarball has a problem.
 *
 * Run as `bun run pack-check`, after `bun run build`.
 * `scripts/publish-package.ts` runs the same check on the tarball it
 * publishes.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/** The manifest fields the check reads from a packed `package.json`. */
export interface PackedManifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly exports?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

/** What a packed tarball holds, read back from the archive. */
export interface PackedTarball {
  /** File paths inside the archive, without its `package/` prefix. */
  readonly entries: readonly string[];
  readonly manifest: PackedManifest;
  /** The packed `LICENSE`, or `''` when the tarball has none. */
  readonly license: string;
  /** The packed `NOTICE`, or `''` when the tarball has none. */
  readonly notice: string;
}

/** The repository's own `LICENSE` and `NOTICE`, which every tarball must match. */
export interface LegalFiles {
  readonly license: string;
  readonly notice: string;
}

/** Files every tarball carries at its root, besides its `dist/`. */
const ROOT_FILES = ['package.json', 'README.md', 'LICENSE', 'NOTICE'];

const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;

/**
 * Every file path an `exports` map names, in map order, without the
 * leading `./`.
 *
 * @param exports - A manifest's `exports` field, any nesting of conditions.
 * @returns The paths, one per string leaf of the map.
 */
export function exportTargets(exports: unknown): string[] {
  if (typeof exports === 'string') {
    return [exports.replace(/^\.\//, '')];
  }
  if (exports === null || typeof exports !== 'object') {
    return [];
  }
  return Object.values(exports).flatMap(exportTargets);
}

/**
 * The problems of a packed tarball: a root file it lacks, a legal file
 * that differs from the repository's, a source map, a test or a file
 * outside `dist/` it ships, an export target it lacks, and a dependency
 * still on the workspace protocol.
 *
 * @param packed - The tarball, read back with {@link packPackage}.
 * @param legal - The repository's `LICENSE` and `NOTICE`.
 * @returns One line per problem; empty when the tarball can ship.
 */
export function tarballProblems(packed: PackedTarball, legal: LegalFiles): string[] {
  const shipped = new Set(packed.entries);
  const missing = ROOT_FILES.filter((file) => !shipped.has(file)).map((file) => `lacks ${file}`);
  const legalDrift = [
    ...(shipped.has('LICENSE') && packed.license !== legal.license
      ? ['LICENSE differs from the repository root copy']
      : []),
    ...(shipped.has('NOTICE') && packed.notice !== legal.notice
      ? ['NOTICE differs from the repository root copy']
      : []),
  ];
  const extra = packed.entries.flatMap((entry) => {
    if (entry.endsWith('.map')) return [`ships a source map: ${entry}`];
    if (/\.test\.[cm]?[jt]s$/.test(entry)) return [`ships a test: ${entry}`];
    if (!entry.startsWith('dist/') && !ROOT_FILES.includes(entry)) return [`ships a file outside dist: ${entry}`];
    return [];
  });
  const unexported = exportTargets(packed.manifest.exports)
    .filter((target) => !shipped.has(target))
    .map((target) => `exports ${target}, which the tarball lacks`);
  const workspaceRanges = DEPENDENCY_FIELDS.flatMap((field) => Object.entries(packed.manifest[field] ?? {})
    .filter(([, range]) => range.startsWith('workspace:'))
    .map(([name, range]) => `${field} ${name} is ${range}`));
  return [...missing, ...legalDrift, ...extra, ...unexported, ...workspaceRanges];
}

/**
 * The npm dist-tag a version publishes under: `next` for a prerelease,
 * so it never becomes what `npm install` picks, and `latest` otherwise.
 *
 * @param version - A semver version, build metadata allowed.
 * @returns `'next'` when the version has a prerelease part, else `'latest'`.
 */
export function distTag(version: string): 'latest' | 'next' {
  return version.split('+')[0]?.includes('-')
    ? 'next'
    : 'latest';
}

function run(command: readonly string[], cwd?: string): string {
  const proc = Bun.spawnSync([...command], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited ${proc.exitCode}: ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString();
}

function readPacked(tarball: string, file: string, entries: readonly string[]): string {
  return entries.includes(file)
    ? run(['tar', '-xOzf', tarball, `package/${file}`])
    : '';
}

/**
 * Packs the package in `dir` with `bun pm pack` into `outDir`, and reads
 * the tarball back.
 *
 * @param dir - The package folder.
 * @param outDir - Where the tarball is written; created when missing.
 * @returns The tarball's path and what it holds.
 */
export function packPackage(dir: string, outDir: string): { path: string; packed: PackedTarball } {
  mkdirSync(outDir, { recursive: true });
  const written = run(['bun', 'pm', 'pack', '--quiet', '--destination', resolve(outDir)], dir).trim();
  const path = resolve(outDir, basename(written));
  const entries = run(['tar', '-tzf', path])
    .split('\n')
    .filter((line) => line !== '' && !line.endsWith('/'))
    .map((line) => line.replace(/^package\//, ''));
  const manifest = JSON.parse(readPacked(path, 'package.json', entries)) as PackedManifest;
  return {
    path,
    packed: { entries, manifest, license: readPacked(path, 'LICENSE', entries), notice: readPacked(path, 'NOTICE', entries) },
  };
}

/** The repository root, the folder above `scripts/`. */
export const REPO_ROOT = resolve(import.meta.dir, '..');

/** Reads the repository's `LICENSE` and `NOTICE`. */
export function readLegalFiles(root: string = REPO_ROOT): LegalFiles {
  return { license: readFileSync(join(root, 'LICENSE'), 'utf8'), notice: readFileSync(join(root, 'NOTICE'), 'utf8') };
}

function publicPackageDirs(root: string): string[] {
  const packages = join(root, 'packages');
  return readdirSync(packages)
    .map((name) => join(packages, name))
    .filter((dir) => !(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackedManifest).private);
}

if (import.meta.main) {
  const outDir = mkdtempSync(join(tmpdir(), 'pack-check-'));
  const legal = readLegalFiles();
  let failed = false;
  try {
    for (const dir of publicPackageDirs(REPO_ROOT)) {
      const { packed } = packPackage(dir, outDir);
      const problems = tarballProblems(packed, legal);
      const label = `${packed.manifest.name}@${packed.manifest.version}`;
      if (problems.length === 0) {
        console.log(`${label}: ${packed.entries.length} files, ok`);
        continue;
      }
      failed = true;
      problems.forEach((problem) => console.error(`${label}: ${problem}`));
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  process.exit(failed
    ? 1
    : 0);
}
