defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: 'Remove the current user\'s password',
    description: 'Deletes the password credential for the authenticated user. Refused if the user has no passkeys (would leave them with no way to sign in).',
    operationId: 'removeOwnPassword',
    responses: {
      200: { description: 'Password removed' },
      400: { description: 'No password to remove' },
      401: { description: 'Unauthorized' },
      409: { description: 'Cannot remove the last credential' },
    },
  },
});

import { requireAuth } from '../../utils/auth-helpers';
import { getCredentialSummary, removeUserPassword } from '../../utils/auth';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const summary = getCredentialSummary(user.id);

  if (!summary.hasPassword) {
    throw createError({ statusCode: 400, statusMessage: 'You do not have a password to remove' });
  }
  if (summary.passkeyCount === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Add at least one passkey before removing your password',
    });
  }

  removeUserPassword(user.id);
  return { ok: true };
});
