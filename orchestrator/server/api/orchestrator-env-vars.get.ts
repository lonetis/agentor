defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List orchestrator environment variables',
    description: 'Returns system environment variables passed to all agent workers.',
    operationId: 'listOrchestratorEnvVars',
    responses: {
      200: {
        description: 'Array of environment variable objects',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } } } } } },
      },
    },
  },
});

import { useConfig } from '../utils/services';
import { listInitPresets } from '../utils/init-presets';
import { listGitProviders } from '../utils/git-providers';
import type { Config } from '../utils/config';

export default defineEventHandler(() => {
  const config = useConfig();
  const vars: { name: string; configured: boolean }[] = [];

  for (const provider of listGitProviders()) {
    const value = config[provider.tokenConfigKey as keyof Config];
    vars.push({ name: provider.tokenEnvVar, configured: !!value });
  }

  const seen = new Set<string>();
  for (const preset of listInitPresets()) {
    for (const [envName, configKey] of Object.entries(preset.envVars)) {
      if (seen.has(envName)) continue;
      seen.add(envName);
      const value = config[configKey as keyof Config];
      vars.push({ name: envName, configured: !!value });
    }
  }

  return vars;
});
