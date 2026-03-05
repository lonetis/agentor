defineRouteMeta({
  openAPI: {
    tags: ['GitHub'],
    summary: 'Create GitHub repo',
    description: 'Creates a new GitHub repository for the authenticated user.',
    operationId: 'createGitHubRepo',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', description: 'Repository name' },
              private: { type: 'boolean', description: 'Whether the repo is private' },
              description: { type: 'string', description: 'Repository description' },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Created repository', content: { 'application/json': { schema: { type: 'object', properties: { full_name: { type: 'string' }, html_url: { type: 'string' } } } } } },
      400: { description: 'Error creating repo', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useGitHubService } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const body = await readBody<{ owner: string; name: string; private: boolean }>(event);

  if (!body.owner || !body.name) {
    throw createError({ statusCode: 400, statusMessage: 'Missing owner or name' });
  }

  const github = useGitHubService();

  if (!github.hasToken) {
    throw createError({ statusCode: 400, statusMessage: 'GitHub token not configured' });
  }

  const repo = await github.createRepo(body.owner, body.name, body.private ?? false);
  return { repo };
});
