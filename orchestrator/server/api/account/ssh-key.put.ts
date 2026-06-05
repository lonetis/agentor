defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: "Update the current user's SSH public key",
    description: "Writes the SSH public key(s) to `<DATA_DIR>/users/<userId>/ssh/authorized_keys` (the field is stored 1:1 with this file — empty string writes an empty file, disabling logins). The file is bind-mounted read-only into every worker the user owns, so changes are visible to running SSH apps immediately. Owner-only.",
    operationId: 'putAccountSshKey',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { sshPublicKey: { type: 'string' } },
          },
        },
      },
    },
    responses: {
      200: { description: 'Updated SSH public key' },
      400: { description: 'Invalid request body' },
      401: { description: 'Unauthorized' },
    },
  },
});

import { requireAuth } from '../../utils/auth-helpers';
import { useStorageManager } from '../../utils/services';
import type { UserSshKey } from '../../../shared/types';

export default defineEventHandler(async (event): Promise<UserSshKey> => {
  const { user } = requireAuth(event);
  const body = await readBody<{ sshPublicKey?: unknown }>(event);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Request body must be a JSON object' });
  }
  if (body.sshPublicKey !== undefined && typeof body.sshPublicKey !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'sshPublicKey must be a string' });
  }
  const storage = useStorageManager();
  await storage.writeSshAuthorizedKeys(user.id, (body.sshPublicKey as string) ?? '');
  return { sshPublicKey: await storage.readSshAuthorizedKeys(user.id) };
});
