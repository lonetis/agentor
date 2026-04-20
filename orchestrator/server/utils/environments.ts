import { nanoid } from 'nanoid';
import { BuiltInAndUserStore } from './built-in-and-user-store';
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
  userId: string | null;
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

/** Built-in environments live in `<DATA_DIR>/defaults/environments.json`.
 * User-created environments live in `<DATA_DIR>/users/<userId>/environments.json`. */
export class EnvironmentStore extends BuiltInAndUserStore<Environment, BuiltInEnvironment> {
  constructor(dataDir: string) {
    super(dataDir, 'environments.json', 'environment');
  }

  async create(data: Omit<Environment, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>): Promise<Environment> {
    if (!data.userId) throw new Error('create: userId is required for user environments');
    const now = new Date().toISOString();
    const env: Environment = { ...data, id: nanoid(12), builtIn: false, createdAt: now, updatedAt: now };
    await this.setItem(data.userId, env);
    useLogger().info(`[environment] created "${env.name}" (${env.id}) for user ${env.userId}`);
    return env;
  }

  update(id: string, data: Partial<Omit<Environment, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>>): Promise<Environment> {
    return this.updateUserItem(id, data as Partial<Environment>);
  }

  protected override snapshotBuiltIn(item: BuiltInEnvironment, now: string): Environment {
    return {
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
      userId: null,
      createdAt: now,
      updatedAt: now,
    };
  }
}
