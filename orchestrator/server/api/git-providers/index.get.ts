defineRouteMeta({
  openAPI: {
    tags: ['Git'],
    summary: 'List git providers',
    description:
      'Returns the git hosting providers workers can clone from: GitHub, gitlab.com, and any self-managed GitLab servers the administrator configured. A worker repo references a provider by `id`. Each provider authenticates with a per-user token stored in the user\'s env vars under `tokenEnvVar` (e.g. `GITHUB_TOKEN`, `GITLAB_TOKEN`); `tokenConfigured` tells whether the calling user has set it. With a token, private repos clone and the repo/branch tools work.',
    operationId: 'listGitProviders',
    responses: {
      200: {
        description: 'Array of git providers',
        content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/GitProvider' } } } },
      },
      401: { description: 'Unauthorized' },
    },
    $global: {
      components: {
        schemas: {
          GitProvider: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Provider id used in a worker repo\'s `provider` field (`github`, `gitlab`, `gitlab-<name>`)' },
              type: { type: 'string', enum: ['github', 'gitlab'] },
              displayName: { type: 'string' },
              url: { type: 'string', description: 'Web base URL of the provider' },
              placeholder: { type: 'string', description: 'Example clone URL' },
              tokenEnvVar: { type: 'string', description: 'Env var name holding the user\'s token for this provider' },
              tokenConfigured: { type: 'boolean', description: 'Whether the calling user has set `tokenEnvVar`' },
            },
          },
          GitRepo: {
            type: 'object',
            properties: {
              fullName: { type: 'string', description: 'Path on the provider: `owner/repo` (GitHub) or `group[/subgroup]/project` (GitLab). Usable as a worker repo `url`.' },
              private: { type: 'boolean' },
              defaultBranch: { type: 'string' },
            },
          },
        },
      },
    },
  },
});

import type { GitProviderInfo } from '../../../shared/types';
import { listGitProviders } from '../../utils/git-providers';
import { useUserEnvStore } from '../../utils/services';
import { getUserEnvVar } from '../../utils/user-env-store';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event): GitProviderInfo[] => {
  const { user } = requireAuth(event);
  const env = useUserEnvStore().getOrDefault(user.id);
  return listGitProviders().map((p) => ({
    id: p.id,
    type: p.type,
    displayName: p.displayName,
    url: p.url,
    placeholder: p.placeholder,
    tokenEnvVar: p.tokenEnvVar,
    tokenConfigured: getUserEnvVar(env, p.tokenEnvVar).length > 0,
  }));
});
