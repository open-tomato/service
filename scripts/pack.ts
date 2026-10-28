/**
 * Pack check: packs each public package the way a release publishes it,
 * then reads the tarball back and checks what it would ship. It prints one
 * line per package and exits 1 when any tarball has a problem.
 *
 * A package is packed from a staged copy whose `workspace:` ranges are
 * filled in from each sibling's own `package.json`. `bun pm pack` would
 * fill them in from `bun.lock`, which keeps the version a workspace package
 * had when it was installed: `rafa release settle` moves the manifests and
 * not the lockfile, so 1.0.0 shipped with `^0.0.0` and could not install.
 *
 * Run as `bun run pack-check`, after `bun run build`.
 * `scripts/publish-package.ts` runs the same check on the tarball it
 * publishes.
 */

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

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

/** Each workspace package's name and the version its own `package.json` declares. */
export type WorkspaceVersions = Readonly<Record<string, string>>;

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
 * outside `dist/` it ships, an export target it lacks, a dependency still
 * on the workspace protocol, and a range for a workspace package that its
 * version does not satisfy.
 *
 * @param packed - The tarball, read back with {@link packPackage}.
 * @param legal - The repository's `LICENSE` and `NOTICE`.
 * @param workspaceVersions - The workspace packages' versions.
 * @returns One line per problem; empty when the tarball can ship.
 */
export function tarballProblems(packed: PackedTarball, legal: LegalFiles, workspaceVersions: WorkspaceVersions = {}): string[] {
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
  const unsatisfied = DEPENDENCY_FIELDS.flatMap((field) => Object.entries(packed.manifest[field] ?? {})
    .filter(([name, range]) => !range.startsWith('workspace:') && workspaceVersions[name] !== undefined
      && !Bun.semver.satisfies(workspaceVersions[name], range))
    .map(([name, range]) => `${field} ${name} is ${range}, which ${workspaceVersions[name]} in this workspace does not satisfy`));
  return [...missing, ...legalDrift, ...extra, ...unexported, ...workspaceRanges, ...unsatisfied];
}

function resolveRange(field: string, name: string, range: string, workspaceVersions: WorkspaceVersions): string {
  if (!range.startsWith('workspace:')) return range;
  const version = workspaceVersions[name];
  if (version === undefined) {
    throw new Error(`${field} ${name} is ${range}, and the workspace holds no package of that name`);
  }
  const spec = range.slice('workspace:'.length);
  if (spec === '^' || spec === '~') return `${spec}${version}`;
  if (spec === '*') return version;
  return spec;
}

/**
 * A copy of `manifest` with every `workspace:` range filled in from the
 * workspace: `workspace:^` and `workspace:~` take the sibling's version
 * behind their operator, `workspace:*` takes it exactly, and any other
 * `workspace:<range>` keeps its range.
 *
 * @param manifest - A parsed `package.json`; left as it is.
 * @param workspaceVersions - The workspace packages' versions.
 * @returns The new manifest.
 * @throws When a `workspace:` range names a package the workspace lacks.
 */
export function resolveWorkspaceRanges<T extends object>(manifest: T, workspaceVersions: WorkspaceVersions): T {
  const resolved = DEPENDENCY_FIELDS.flatMap((field) => {
    const deps = (manifest as Record<string, unknown>)[field] as Record<string, string> | undefined;
    if (deps === undefined) return [];
    const ranges = Object.entries(deps).map(([name, range]) => [name, resolveRange(field, name, range, workspaceVersions)]);
    return [[field, Object.fromEntries(ranges)]];
  });
  return { ...manifest, ...Object.fromEntries(resolved) };
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

/** Folders a staged copy leaves out: installed and cached files, never packed. */
const NOT_STAGED = /(^|\/)(node_modules|\.turbo)(\/|$)/;

/**
 * Packs the package in `dir` into `outDir` and reads the tarball back. The
 * package is staged first: copied to a scratch folder with its `workspace:`
 * ranges filled in by {@link resolveWorkspaceRanges}, so `bun pm pack`
 * there never consults `bun.lock`. `dir` itself is left as it is.
 *
 * @param dir - The package folder.
 * @param outDir - Where the tarball is written; created when missing.
 * @param workspaceVersions - The workspace packages' versions.
 * @returns The tarball's path and what it holds.
 */
export function packPackage(dir: string, outDir: string, workspaceVersions: WorkspaceVersions = {}): { path: string; packed: PackedTarball } {
  mkdirSync(outDir, { recursive: true });
  const staged = mkdtempSync(join(tmpdir(), 'pack-stage-'));
  let written: string;
  try {
    cpSync(dir, staged, { recursive: true, filter: (source) => !NOT_STAGED.test(relative(dir, source)) });
    const source = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as object;
    writeFileSync(join(staged, 'package.json'), `${JSON.stringify(resolveWorkspaceRanges(source, workspaceVersions), null, 2)}\n`);
    written = run(['bun', 'pm', 'pack', '--quiet', '--destination', resolve(outDir)], staged).trim();
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
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

function readManifest(dir: string): PackedManifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackedManifest;
}

function packageDirs(root: string): string[] {
  const packages = join(root, 'packages');
  return readdirSync(packages).map((name) => join(packages, name));
}

/** Reads each workspace package's name and the version its `package.json` declares. */
export function readWorkspaceVersions(root: string = REPO_ROOT): WorkspaceVersions {
  return Object.fromEntries(packageDirs(root).map((dir) => readManifest(dir))
    .map((manifest) => [manifest.name, manifest.version]));
}

function publicPackageDirs(root: string): string[] {
  return packageDirs(root).filter((dir) => !readManifest(dir).private);
}

if (import.meta.main) {
  const outDir = mkdtempSync(join(tmpdir(), 'pack-check-'));
  const legal = readLegalFiles();
  const versions = readWorkspaceVersions();
  let failed = false;
  try {
    for (const dir of publicPackageDirs(REPO_ROOT)) {
      const { packed } = packPackage(dir, outDir, versions);
      const problems = tarballProblems(packed, legal, versions);
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
