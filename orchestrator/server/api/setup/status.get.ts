defineRouteMeta({
  openAPI: {
    tags: ['Setup'],
    summary: 'First-run setup status',
    description: 'Returns whether the system still needs an initial admin user.',
    operationId: 'getSetupStatus',
    responses: {
      200: {
        description: 'Setup status',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                needsSetup: { type: 'boolean', description: 'True if no users exist yet' },
              },
              required: ['needsSetup'],
            },
          },
        },
      },
    },
  },
});

import { hasAnyUsers, useAuth } from '../../utils/auth';

export default defineEventHandler(() => {
  // Ensure auth is initialized (so the user table exists before we query it)
  useAuth();
  return { needsSetup: !hasAnyUsers() };
});
