defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Rename worker',
    description: 'Updates a worker\'s editable, user-facing display name. The internal identity (UUID, container name, volumes, routing) is immutable, so no container recreation occurs — the running worker keeps serving uninterrupted.',
    operationId: 'renameContainer',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Worker container ID' },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['displayName'],
            properties: {
              displayName: { type: 'string', description: 'New user-facing display name (free-form, non-empty)' },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Updated container info', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContainerInfo' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useContainerManager } from '../../../utils/services';
import { MAX_DISPLAY_NAME_LENGTH } from '../../../utils/validation';
import { requireContainerAccess } from '../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const body = await readBody(event);

  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!displayName) {
    throw createError({ statusCode: 400, statusMessage: 'displayName is required' });
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters` });
  }

  const containerManager = useContainerManager();
  const container = containerManager.get(id);
  if (!container) {
    throw createError({ statusCode: 404, statusMessage: 'Container not found' });
  }

  requireContainerAccess(event, container);

  return containerManager.rename(id, displayName);
});
