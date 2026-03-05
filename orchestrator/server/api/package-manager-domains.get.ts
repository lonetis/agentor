defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List package manager domains',
    description: 'Returns the list of package manager domains allowed through the firewall.',
    operationId: 'listPackageManagerDomains',
    responses: {
      200: {
        description: 'Array of domain strings',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
      },
    },
  },
});

import { getPackageManagerDomains } from '../utils/environments';

export default defineEventHandler(() => {
  return getPackageManagerDomains();
});
