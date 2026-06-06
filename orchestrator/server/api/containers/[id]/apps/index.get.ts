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
              status: { type: 'string', enum: ['running', 'stopped', 'auth_required'] },
              externalPort: { type: 'integer', description: 'Mapped external port (e.g. ssh)' },
              machineName: { type: 'string', description: 'Microsoft tunnel machine name (vscode)' },
              authUrl: { type: 'string', description: 'GitHub device-code URL while authenticating (vscode)' },
              authCode: { type: 'string', description: 'GitHub device code while authenticating (vscode)' },
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

  // Each app type is an independent docker-exec round trip — run them
  // concurrently rather than serially.
  const appTypes = listAppTypes();
  const results = await Promise.allSettled(
    appTypes.map((appType) => containerManager.listAppInstances(id, appType.id)),
  );

  const allInstances: AppInstanceInfo[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      allInstances.push(...result.value);
    } else {
      // The container might be stopped or the app script missing — degrade to an
      // empty list, but make the failure observable in the centralized log.
      const reason = result.reason instanceof Error ? result.reason.message : result.reason;
      useLogger().debug(`[apps] list failed for ${id}/${appTypes[i]?.id}: ${reason}`);
    }
  });

  return allInstances;
});
