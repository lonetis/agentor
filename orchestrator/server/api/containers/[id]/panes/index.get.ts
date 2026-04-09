defineRouteMeta({
  openAPI: {
    tags: ['Tmux'],
    summary: 'List tmux windows',
    description: 'Returns all tmux windows in the container session.',
    operationId: 'listTmuxWindows',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: {
        description: 'Array of tmux windows',
        content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/TmuxWindow' } } } },
      },
    },
    $global: {
      components: {
        schemas: {
          TmuxWindow: {
            type: 'object',
            properties: {
              index: { type: 'integer' },
              name: { type: 'string' },
              active: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
});

import { useContainerManager } from '../../../../utils/services';
import { requireContainerAccess } from '../../../../utils/auth-helpers';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();
  requireContainerAccess(event, containerManager.get(id));
  return containerManager.listTmuxWindows(id);
});
