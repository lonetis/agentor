defineRouteMeta({
  openAPI: {
    tags: ['Git'],
    summary: 'List repository branches',
    description:
      'Returns the branches and the default branch of a repository on a git provider, using the calling user\'s token. Use a branch name as a worker repo\'s `branch`.',
    operationId: 'listGitBranches',
    parameters: [
      { name: 'providerId', in: 'path', required: true, schema: { type: 'string' }, description: 'Git provider id from list_git_providers' },
      { name: 'repo', in: 'query', required: true, schema: { type: 'string' }, description: 'Repository `fullName` from list_git_repos, e.g. `owner/repo` or `group/subgroup/project`' },
    ],
    responses: {
      200: {
        description: 'Branches and default branch',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                branches: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
                defaultBranch: { type: 'string' },
              },
            },
          },
        },
      },
      400: { description: 'Missing or malformed repo, or no token configured', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized' },
      404: { description: 'Unknown git provider or repository', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      502: { description: 'The provider rejected the token or is unreachable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import type { GitBranchList } from '../../../../shared/types';
import { requireGitHostingService } from '../../../utils/git-hosting';

export default defineEventHandler(async (event): Promise<GitBranchList> => {
  const service = requireGitHostingService(event);
  const repo = getQuery(event).repo;
  if (typeof repo !== 'string' || !repo.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Missing repo query parameter' });
  }
  return service.listBranches(repo.trim().replace(/\.git$/, ''));
});
