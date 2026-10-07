defineRouteMeta({
  openAPI: {
    tags: ['Git'],
    summary: 'Create git repository',
    description:
      'Creates a new, empty repository on a git provider with the calling user\'s token. `owner` is the user\'s own `username` or one of the `namespaces` from list_git_repos (a GitHub org, or a GitLab group path such as `group/subgroup`). Returns the repository; use its `fullName` as a worker repo `url`.',
    operationId: 'createGitRepo',
    parameters: [
      { name: 'providerId', in: 'path', required: true, schema: { type: 'string' }, description: 'Git provider id from list_git_providers' },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['owner', 'name'],
            properties: {
              owner: { type: 'string', description: 'User login or namespace (org / group path) to create the repository in' },
              name: { type: 'string', description: 'Repository name' },
              private: { type: 'boolean', description: 'Create as private (default false)' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Created repository',
        content: { 'application/json': { schema: { type: 'object', properties: { repo: { $ref: '#/components/schemas/GitRepo' } } } } },
      },
      400: { description: 'Invalid input, no token configured, or rejected by the provider (e.g. name taken)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      401: { description: 'Unauthorized' },
      404: { description: 'Unknown git provider or owner', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      502: { description: 'The provider rejected the token or is unreachable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { requireGitHostingService } from '../../../utils/git-hosting';

export default defineEventHandler(async (event) => {
  const service = requireGitHostingService(event);
  const body = await readBody<{ owner?: unknown; name?: unknown; private?: unknown }>(event);
  const owner = typeof body?.owner === 'string' ? body.owner.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!owner || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Missing owner or name' });
  }

  const repo = await service.createRepo(owner, name, body.private === true);
  return { repo };
});
