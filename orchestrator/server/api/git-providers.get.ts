import { listGitProviders } from '../utils/git-providers';
import { useConfig } from '../utils/services';

export default defineEventHandler(() => {
  const config = useConfig();
  return listGitProviders().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    placeholder: p.placeholder,
    tokenConfigured: !!(config as unknown as Record<string, unknown>)[p.tokenConfigKey],
  }));
});
