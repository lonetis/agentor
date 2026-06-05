defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: "Get the current user's SSH public key",
    description: "Returns the SSH public key(s) the user has configured, read 1:1 from `<DATA_DIR>/users/<userId>/ssh/authorized_keys`. This file (not env-vars.json) is the SSH key's only home; it is bind-mounted read-only into every worker the user owns and used by the SSH app. Owner-only.",
    operationId: 'getAccountSshKey',
    responses: {
      200: {
        description: 'User SSH public key',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { sshPublicKey: { type: 'string' } },
              required: ['sshPublicKey'],
            },
          },
        },
      },
      401: { description: 'Unauthorized' },
    },
  },
});

import { requireAuth } from '../../utils/auth-helpers';
import { useStorageManager } from '../../utils/services';
import type { UserSshKey } from '../../../shared/types';

export default defineEventHandler(async (event): Promise<UserSshKey> => {
  const { user } = requireAuth(event);
  return { sshPublicKey: await useStorageManager().readSshAuthorizedKeys(user.id) };
});
