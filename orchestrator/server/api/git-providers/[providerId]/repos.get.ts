defineRouteMeta({
  openAPI: {
    tags: ['Git'],
    summary: 'List git repositories',
    description:
      'Lists the repositories the calling user can access on a git provider (see list_git_providers), using the token from the user\'s env vars. Pass a repo\'s `fullName` as `url` (with this `provider`) in a worker\'s `repos`. Also returns the token\'s `username` and the other `namespaces` (GitHub orgs, GitLab groups) where create_git_repo can create repositories. Without a token, `repos` is empty and `tokenConfigured` is false; when the provider rejects the token or is unreachable, `error` says why.',
    operationId: 'listGitRepos',
    parameters: [
      { name: 'providerId', in: 'path', required: true, schema: { type: 'string' }, description: 'Git provider id from list_git_providers, e.g. `github` or `gitlab`' },
    ],
    responses: {
      200: {
        description: 'Repositories plus token/account context',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                repos: { type: 'array', items: { $ref: '#/components/schemas/GitRepo' } },
                tokenConfigured: { type: 'boolean' },
                username: { type: 'string', description: 'The token\'s account — default owner for new repositories' },
                namespaces: { type: 'array', items: { type: 'string' }, description: 'Other owners the user can create repositories under (GitHub orgs, GitLab group paths)' },
                error: { type: 'string', description: 'Set when a token IS configured but the provider request failed (bad token, missing scopes, rate limit, unreachable)' },
              },
            },
          },
        },
      },
      401: { description: 'Unauthorized' },
      404: { description: 'Unknown git provider', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import type { GitRepoList } from '../../../../shared/types';
import { getGitHostingService, resolveGitProviderForUser } from '../../../utils/git-hosting';

export default defineEventHandler(async (event): Promise<GitRepoList> => {
  const { provider, token } = resolveGitProviderForUser(event);
  if (!token) {
    return { repos: [], tokenConfigured: false, username: '', namespaces: [] };
  }

  const service = getGitHostingService(provider, token);
  try {
    const [repos, username, namespaces] = await Promise.all([
      service.listRepos(),
      service.getUsername(),
      service.listNamespaces(),
    ]);
    return { repos, tokenConfigured: true, username, namespaces };
  } catch (err) {
    // A token IS configured — surface the failure instead of masquerading as
    // "no token", so the UI can show the cause rather than an empty dropdown.
    const message = (err as { statusMessage?: string }).statusMessage
      || (err instanceof Error ? err.message : `${provider.displayName} request failed`);
    return { repos: [], tokenConfigured: true, username: '', namespaces: [], error: message };
  }
});
