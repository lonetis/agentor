defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: 'Get the current user\'s credential summary',
    description: 'Returns whether the current user has a password set and how many passkeys are registered. Used by the account modal to decide which forms to show.',
    operationId: 'getCredentialSummary',
    responses: {
      200: {
        description: 'Credential summary',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                hasPassword: { type: 'boolean' },
                passkeyCount: { type: 'integer' },
              },
              required: ['hasPassword', 'passkeyCount'],
            },
          },
        },
      },
      401: { description: 'Unauthorized' },
    },
  },
});

import { requireAuth } from '../../utils/auth-helpers';
import { getCredentialSummary } from '../../utils/auth';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  return getCredentialSummary(user.id);
});
