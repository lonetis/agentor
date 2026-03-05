defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Generate container name',
    description: 'Returns a randomly generated container name.',
    operationId: 'generateContainerName',
    responses: {
      200: {
        description: 'Generated name',
        content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } },
      },
    },
  },
});

import { useContainerManager } from '../../utils/services';

export default defineEventHandler(() => {
  return { name: useContainerManager().generateName() };
});
