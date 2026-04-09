defineRouteMeta({
  openAPI: {
    tags: ['Apps'],
    summary: 'List all apps',
    description: 'Returns all running app instances across all app types in a container.',
    operationId: 'listAllApps',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: {
        description: 'Array of app instances',
        content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AppInstanceInfo' } } } },
      },
    },
    $global: {
      components: {
        schemas: {
          AppInstanceInfo: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              appType: { type: 'string' },
              port: { type: 'integer' },
              status: { type: 'string', enum: ['running', 'stopped'] },
            },
          },
        },
      },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';
import { requireContainerAccess } from '../../../../utils/auth-helpers';
import { listAppTypes } from '../../../../utils/apps';
import type { AppInstanceInfo } from '../../../../../shared/types';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();
  requireContainerAccess(event, containerManager.get(id));

  const allInstances: AppInstanceInfo[] = [];

  for (const appType of listAppTypes()) {
    try {
      const instances = await containerManager.listAppInstances(id, appType.id);
      allInstances.push(...instances);
    } catch {
      // Container might be stopped or app script missing
    }
  }

  return allInstances;
});
