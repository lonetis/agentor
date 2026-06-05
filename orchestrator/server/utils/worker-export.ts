import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import * as tar from 'tar-stream';
import type { Environment } from './environments';
import type { PortMapping } from './port-mapping-store';
import type { DomainMapping } from './domain-mapping-store';
import type { RepoConfig, MountConfig } from '../../shared/types';

/** Bumped when the bundle layout changes incompatibly. */
export const WORKER_EXPORT_VERSION = 1;

/** Container paths whose contents are exported as separate volume tars (their
 * data lives in volumes, which `docker export` deliberately omits). */
export const EXPORT_WORKSPACE_PATH = '/workspace';
export const EXPORT_AGENTS_PATH = '/home/agent/.agent-data';
/** Parent dirs the volume tars are restored under (tar entries are prefixed
 * with the basename of the source path). */
export const RESTORE_WORKSPACE_PARENT = '/';
export const RESTORE_AGENTS_PARENT = '/home/agent';

/** Per-user OAuth credential files that live inside the agents dir as bind
 * mounts (the worker owner's secrets) — stripped from the agents tar on export
 * so an export never leaks another user's tokens. */
export const CREDENTIAL_EXCLUDE_SUFFIXES = [
  '.claude/.credentials.json',
  '.codex/auth.json',
  '.gemini/oauth_creds.json',
];

/** File names inside the outer bundle tar. */
export const BUNDLE_FILES = {
  manifest: 'manifest.json',
  rootfs: 'rootfs.tar.gz',
  workspace: 'workspace.tar.gz',
  agents: 'agents.tar.gz',
} as const;

/** What a port mapping looks like once stripped of identity for re-creation. */
export type ExportedPortMapping = Pick<
  PortMapping,
  'externalPort' | 'type' | 'internalPort' | 'appType' | 'instanceId'
>;

export type ExportedDomainMapping = Pick<
  DomainMapping,
  'subdomain' | 'baseDomain' | 'path' | 'protocol' | 'wildcard' | 'internalPort' | 'basicAuth'
>;

export interface WorkerExportManifest {
  version: number;
  exportedAt: string;
  /** Identity of the source worker (informational; not reused on import). */
  source: { id: string; displayName: string; containerName: string; imageName: string };
  /** The worker's own rebuild-time config, restored onto the new worker. */
  worker: { displayName: string; repos: RepoConfig[]; mounts: MountConfig[]; initScript: string };
  /** Full environment definition, embedded so the worker restores on a machine
   * that does not have the same environment. Matched/created on import. */
  environment: Environment;
  portMappings: ExportedPortMapping[];
  domainMappings: ExportedDomainMapping[];
  /** Which payloads the bundle contains. */
  contents: { rootfs: boolean; workspace: boolean; agents: boolean };
}

/** Pipe a readable through gzip into a file; return the written size in bytes. */
export async function writeGzipFile(src: NodeJS.ReadableStream, dest: string): Promise<number> {
  await pipeline(src, createGzip(), createWriteStream(dest));
  return (await stat(dest)).size;
}

/** Re-pack an agents tar, dropping per-user credential files, then gzip to a
 * file. Returns the written size. */
export async function writeFilteredAgentsGz(
  src: NodeJS.ReadableStream,
  dest: string,
  excludeSuffixes: string[],
): Promise<number> {
  const extract = tar.extract();
  const pack = tar.pack();

  extract.on('entry', (header, stream, next) => {
    if (excludeSuffixes.some((s) => header.name.endsWith(s))) {
      stream.on('end', next);
      stream.resume();
      return;
    }
    const entry = pack.entry(header, next);
    stream.pipe(entry);
  });
  extract.on('finish', () => pack.finalize());
  extract.on('error', (err) => pack.destroy(err));

  const writeDone = pipeline(pack, createGzip(), createWriteStream(dest));
  // Drive src → extract with pipeline (not a bare .pipe) so a src error tears
  // down extract → pack and rejects, instead of hanging forever waiting for an
  // 'end'/'finish' that never comes.
  await Promise.all([pipeline(src, extract), writeDone]);
  return (await stat(dest)).size;
}

/** Build the outer bundle tar as a readable stream, sourcing each entry from a
 * temp file (sizes are known via stat, so no buffering). */
export function packBundle(files: { name: string; path: string }[]): Readable {
  const pack = tar.pack();
  (async () => {
    for (const f of files) {
      const size = (await stat(f.path)).size;
      await new Promise<void>((resolve, reject) => {
        const entry = pack.entry({ name: f.name, size }, (err) => (err ? reject(err) : resolve()));
        createReadStream(f.path).pipe(entry);
      });
    }
    pack.finalize();
  })().catch((err) => pack.destroy(err instanceof Error ? err : new Error(String(err))));
  return pack;
}

/** Write the manifest JSON to a file. */
export async function writeManifest(manifest: WorkerExportManifest, dest: string): Promise<void> {
  await writeFile(dest, JSON.stringify(manifest, null, 2));
}

export interface ExtractedBundle {
  manifest: WorkerExportManifest;
  /** Absolute paths to the extracted part files that were present. */
  rootfsPath?: string;
  workspacePath?: string;
  agentsPath?: string;
}

/** Extract the outer bundle tar into `destDir`, returning the parsed manifest
 * and the paths of any extracted payloads. */
export async function extractBundle(bundlePath: string, destDir: string): Promise<ExtractedBundle> {
  await mkdir(destDir, { recursive: true });
  const known = new Set<string>(Object.values(BUNDLE_FILES));
  const present = new Set<string>();
  const extract = tar.extract();

  await new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const name = header.name.replace(/^\.?\//, '');
      if (!known.has(name)) {
        stream.on('end', next);
        stream.resume();
        return;
      }
      present.add(name);
      pipeline(stream, createWriteStream(join(destDir, name)))
        .then(() => next())
        .catch((err) => reject(err));
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
    createReadStream(bundlePath).pipe(extract);
  });

  if (!present.has(BUNDLE_FILES.manifest)) {
    throw new Error('Invalid worker export: manifest.json missing');
  }
  const manifestRaw = await readFile(join(destDir, BUNDLE_FILES.manifest), 'utf8');
  const manifest = JSON.parse(manifestRaw) as WorkerExportManifest;

  return {
    manifest,
    rootfsPath: present.has(BUNDLE_FILES.rootfs) ? join(destDir, BUNDLE_FILES.rootfs) : undefined,
    workspacePath: present.has(BUNDLE_FILES.workspace) ? join(destDir, BUNDLE_FILES.workspace) : undefined,
    agentsPath: present.has(BUNDLE_FILES.agents) ? join(destDir, BUNDLE_FILES.agents) : undefined,
  };
}
