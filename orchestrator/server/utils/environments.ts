import { nanoid } from 'nanoid';
import { JsonStore } from './json-store';
import { loadConfig } from './config';
import type { NetworkMode, ExposeApis } from '../../shared/types';
import type { BuiltInEnvironment } from './built-in-content';

export interface Environment {
  id: string;
  name: string;
  cpuLimit: number;
  memoryLimit: string;
  networkMode: NetworkMode;
  allowedDomains: string[];
  includePackageManagerDomains: boolean;
  dockerEnabled: boolean;
  envVars: string;
  setupScript: string;
  exposeApis: ExposeApis;
  enabledCapabilityIds: string[] | null;
  enabledInstructionIds: string[] | null;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Returns the active package manager domains list.
 * Uses PACKAGE_MANAGER_DOMAINS env var if set, otherwise falls back to built-in defaults.
 */
export function getPackageManagerDomains(): string[] {
  const config = loadConfig();
  return config.packageManagerDomains.length > 0
    ? config.packageManagerDomains
    : DEFAULT_PACKAGE_MANAGER_DOMAINS;
}

export const DEFAULT_PACKAGE_MANAGER_DOMAINS = [
  // npm / Node.js
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'registry.npmmirror.com',
  'nodejs.org',
  'deb.nodesource.com',
  // PyPI / Python
  'pypi.org',
  'files.pythonhosted.org',
  'pypi.python.org',
  'bootstrap.pypa.io',
  // RubyGems
  'rubygems.org',
  'bundler.io',
  // crates.io / Rust
  'crates.io',
  'static.crates.io',
  'index.crates.io',
  'static.rust-lang.org',
  // Go modules
  'proxy.golang.org',
  'sum.golang.org',
  'storage.googleapis.com',
  // Maven / Gradle / Java
  'repo.maven.apache.org',
  'repo1.maven.org',
  'plugins.gradle.org',
  'services.gradle.org',
  'jcenter.bintray.com',
  'maven.google.com',
  'dl.google.com',
  // NuGet / .NET
  'api.nuget.org',
  'nuget.org',
  'dotnetcli.azureedge.net',
  'dotnet.microsoft.com',
  // Composer / PHP
  'packagist.org',
  'repo.packagist.org',
  'getcomposer.org',
  // Swift / CocoaPods
  'cocoapods.org',
  'cdn.cocoapods.org',
  'swiftpackageindex.com',
  // Homebrew
  'formulae.brew.sh',
  'ghcr.io',
  'homebrew.bintray.com',
  // Ubuntu / Debian APT
  'archive.ubuntu.com',
  'security.ubuntu.com',
  'ppa.launchpadcontent.net',
  'ppa.launchpad.net',
  'deb.debian.org',
  'security.debian.org',
  'ftp.debian.org',
  'packages.debian.org',
  'apt.llvm.org',
  // Docker Hub
  'registry-1.docker.io',
  'auth.docker.io',
  'production.cloudflare.docker.com',
  'index.docker.io',
  // GitHub (releases, raw, packages, LFS)
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'pkg-containers.githubusercontent.com',
  'npm.pkg.github.com',
  'maven.pkg.github.com',
  'nuget.pkg.github.com',
  // GitLab
  'gitlab.com',
  'packages.gitlab.com',
  // Conda / Anaconda
  'conda.anaconda.org',
  'repo.anaconda.com',
  // Hex / Elixir
  'hex.pm',
  'repo.hex.pm',
  'builds.hex.pm',
  // Hackage / Haskell
  'hackage.haskell.org',
  // CPAN / Perl
  'cpan.org',
  'www.cpan.org',
  'metacpan.org',
  // R / CRAN
  'cran.r-project.org',
  'cloud.r-project.org',
  // WordPress
  'wordpress.org',
  'downloads.wordpress.org',
  'api.wordpress.org',
  // Terraform
  'registry.terraform.io',
  'releases.hashicorp.com',
  'checkpoint-api.hashicorp.com',
  // Cloud providers (SDK/CLI/artifacts)
  'amazonaws.com',
  '*.amazonaws.com',
  'packages.microsoft.com',
  'azure.archive.ubuntu.com',
  'packages.cloud.google.com',
  'apt.kubernetes.io',
  // CDN / common download hosts
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'esm.run',
  'deno.land',
  'jsr.io',
  // Misc
  'sourceforge.net',
  'downloads.sourceforge.net',
  'launchpad.net',
  'ftp-master.debian.org',
  'keyserver.ubuntu.com',
  'keys.openpgp.org',
];

export class EnvironmentStore extends JsonStore<string, Environment> {
  constructor(dataDir: string) {
    super(dataDir, 'environments.json', (e) => e.id);
  }

  override list(): Environment[] {
    return super.list().sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async create(data: Omit<Environment, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>): Promise<Environment> {
    const now = new Date().toISOString();
    const env: Environment = { ...data, id: nanoid(12), builtIn: false, createdAt: now, updatedAt: now };
    this.items.set(env.id, env);
    await this.persist();
    useLogger().info(`[environments] created "${env.name}" (${env.id})`);
    return env;
  }

  async update(id: string, data: Partial<Omit<Environment, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>>): Promise<Environment> {
    const existing = this.items.get(id);
    if (!existing) {
      useLogger().warn(`[environments] update failed — not found: ${id}`);
      throw new Error(`Environment not found: ${id}`);
    }
    if (existing.builtIn) {
      useLogger().warn(`[environments] update rejected — built-in: "${existing.name}" (${id})`);
      throw new Error('Cannot modify built-in environments');
    }
    const updated: Environment = {
      ...existing,
      ...data,
      id: existing.id,
      builtIn: existing.builtIn,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, updated);
    await this.persist();
    useLogger().info(`[environments] updated "${updated.name}" (${id})`);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) {
      useLogger().warn(`[environments] delete failed — not found: ${id}`);
      throw new Error(`Environment not found: ${id}`);
    }
    if (existing.builtIn) {
      useLogger().warn(`[environments] delete rejected — built-in: "${existing.name}" (${id})`);
      throw new Error('Cannot delete built-in environments');
    }
    this.items.delete(id);
    await this.persist();
    useLogger().info(`[environments] deleted "${existing.name}" (${id})`);
  }

  async seedBuiltIns(items: BuiltInEnvironment[]): Promise<void> {
    let changed = false;
    const now = new Date().toISOString();
    const incomingIds = new Set(items.map((i) => i.id));
    useLogger().debug(`[environments] seeding ${items.length} built-in environment(s)`);

    for (const [id, entry] of this.items) {
      if (entry.builtIn && !incomingIds.has(id)) {
        useLogger().info(`[environments] removing stale built-in "${entry.name}" (${id})`);
        this.items.delete(id);
        changed = true;
      }
    }

    for (const item of items) {
      const existing = this.items.get(item.id);
      if (!existing) {
        useLogger().info(`[environments] adding built-in "${item.name}" (${item.id})`);
        this.items.set(item.id, {
          id: item.id,
          name: item.name,
          cpuLimit: item.cpuLimit,
          memoryLimit: item.memoryLimit,
          networkMode: item.networkMode as NetworkMode,
          allowedDomains: item.allowedDomains,
          includePackageManagerDomains: item.includePackageManagerDomains,
          dockerEnabled: item.dockerEnabled,
          envVars: item.envVars,
          setupScript: item.setupScript,
          exposeApis: item.exposeApis,
          enabledCapabilityIds: item.enabledCapabilityIds,
          enabledInstructionIds: item.enabledInstructionIds,
          builtIn: true,
          createdAt: now,
          updatedAt: now,
        });
        changed = true;
      } else if (this.builtInChanged(existing, item)) {
        useLogger().info(`[environments] updating built-in "${item.name}" (${item.id})`);
        this.items.set(item.id, {
          ...existing,
          name: item.name,
          cpuLimit: item.cpuLimit,
          memoryLimit: item.memoryLimit,
          networkMode: item.networkMode as NetworkMode,
          allowedDomains: item.allowedDomains,
          includePackageManagerDomains: item.includePackageManagerDomains,
          dockerEnabled: item.dockerEnabled,
          envVars: item.envVars,
          setupScript: item.setupScript,
          exposeApis: item.exposeApis,
          enabledCapabilityIds: item.enabledCapabilityIds,
          enabledInstructionIds: item.enabledInstructionIds,
          updatedAt: now,
        });
        changed = true;
      }
    }
    if (changed) await this.persist();
    useLogger().info(`[environments] seeded built-ins — ${this.items.size} environment(s) total`);
  }

  private builtInChanged(existing: Environment, incoming: BuiltInEnvironment): boolean {
    return existing.name !== incoming.name
      || existing.cpuLimit !== incoming.cpuLimit
      || existing.memoryLimit !== incoming.memoryLimit
      || existing.networkMode !== incoming.networkMode
      || existing.dockerEnabled !== incoming.dockerEnabled
      || existing.envVars !== incoming.envVars
      || existing.setupScript !== incoming.setupScript
      || JSON.stringify(existing.allowedDomains) !== JSON.stringify(incoming.allowedDomains)
      || JSON.stringify(existing.exposeApis) !== JSON.stringify(incoming.exposeApis)
      || JSON.stringify(existing.enabledCapabilityIds) !== JSON.stringify(incoming.enabledCapabilityIds)
      || JSON.stringify(existing.enabledInstructionIds) !== JSON.stringify(incoming.enabledInstructionIds);
  }
}
