import { randomUUID } from 'node:crypto';
import { BuiltInAndUserStore } from './built-in-and-user-store';
import type { NetworkMode, ExposeApis } from '../../shared/types';
import { builtInId, type BuiltInEnvironment } from './built-in-content';

// Re-exported for backward compatibility — the package-manager domain list and
// accessor now live in their own module (reference data, not store logic).
export { DEFAULT_PACKAGE_MANAGER_DOMAINS, getPackageManagerDomains } from './package-manager-domains';

/** Id of the built-in `default` environment — the fallback used when a worker
 * has no explicit `environmentId`. Stable across restarts (derived UUID). */
export const DEFAULT_ENVIRONMENT_ID = builtInId('environment', 'default');

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

/** Built-in environments live in `<DATA_DIR>/defaults/environments.json`.
 * User-created environments live in `<DATA_DIR>/users/<userId>/environments.json`. */
export class EnvironmentStore extends BuiltInAndUserStore<Environment, BuiltInEnvironment> {
  constructor(dataDir: string) {
    super(dataDir, 'environments.json', 'environment');
  }

  async create(data: Omit<Environment, 'id' | 'builtIn' | 'createdAt' | 'updatedAt'>): Promise<Environment> {
    if (!data.userId) throw new Error('create: userId is required for user environments');
    const now = new Date().toISOString();
    const env: Environment = { ...data, id: randomUUID(), builtIn: false, createdAt: now, updatedAt: now };
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
      networkMode: item.networkMode,
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
