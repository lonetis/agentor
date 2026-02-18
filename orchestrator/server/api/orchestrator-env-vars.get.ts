import { useConfig, useCredentialMountManager } from '../utils/services';
import { listInitPresets } from '../utils/init-presets';
import { listGitProviders } from '../utils/git-providers';
import { AGENT_CREDENTIAL_MAPPINGS } from '../utils/credential-mounts';
import type { Config } from '../utils/config';

export default defineEventHandler(async () => {
  const config = useConfig();
  const credentialMountManager = useCredentialMountManager();
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

  // Credential file status (bind-mounted OAuth tokens)
  for (const mapping of AGENT_CREDENTIAL_MAPPINGS) {
    const configured = await credentialMountManager.getCredentialStatus(mapping.fileName);
    vars.push({ name: `.cred/${mapping.fileName}`, configured });
  }

  return vars;
});
