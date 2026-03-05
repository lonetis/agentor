defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List credential file status',
    description: 'Returns the status of bind-mounted OAuth credential files for each agent.',
    operationId: 'listCredentials',
    responses: {
      200: {
        description: 'Array of credential info objects',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  agentId: { type: 'string' },
                  fileName: { type: 'string' },
                  configured: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  },
});

import { useCredentialMountManager } from '../utils/services';
import { AGENT_CREDENTIAL_MAPPINGS } from '../utils/credential-mounts';
import type { CredentialInfo } from '../../shared/types';

export default defineEventHandler(async (): Promise<CredentialInfo[]> => {
  const credentialMountManager = useCredentialMountManager();

  const results: CredentialInfo[] = [];
  for (const mapping of AGENT_CREDENTIAL_MAPPINGS) {
    const configured = await credentialMountManager.getCredentialStatus(mapping.fileName);
    results.push({
      agentId: mapping.agentId,
      fileName: mapping.fileName,
      configured,
    });
  }

  return results;
});
