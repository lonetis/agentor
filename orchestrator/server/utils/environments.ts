import { nanoid } from 'nanoid';
import { JsonStore } from './json-store';
import { loadConfig } from './config';
import type { NetworkMode } from '../../shared/types';

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
  initScript: string;
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
    return super.list().sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(data: Omit<Environment, 'id' | 'createdAt' | 'updatedAt'>): Promise<Environment> {
    const now = new Date().toISOString();
    const env: Environment = { ...data, id: nanoid(12), createdAt: now, updatedAt: now };
    this.items.set(env.id, env);
    await this.persist();
    return env;
  }

  async update(id: string, data: Partial<Omit<Environment, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Environment> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Environment not found: ${id}`);
    const updated: Environment = {
      ...existing,
      ...data,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, updated);
    await this.persist();
    return updated;
  }

  async delete(id: string): Promise<void> {
    if (!this.items.has(id)) throw new Error(`Environment not found: ${id}`);
    this.items.delete(id);
    await this.persist();
  }
}
