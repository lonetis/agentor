defineRouteMeta({
  openAPI: {
    tags: ['Account'],
    summary: "Reset an agent's OAuth credential for the current user",
    description: 'Clears the stored OAuth credential file for the given agent. The file is replaced with `{}` so the next time the user runs the agent CLI inside a worker they will be prompted to log in fresh.',
    operationId: 'resetAccountAgentCredential',
    parameters: [
      {
        in: 'path',
        name: 'agentId',
        required: true,
        schema: { type: 'string', enum: ['claude', 'codex', 'gemini'] },
      },
    ],
    responses: {
      200: { description: 'Credential reset' },
      400: { description: 'Unknown agent id' },
      401: { description: 'Unauthorized' },
    },
  },
});

import { requireAuth } from '../../../utils/auth-helpers';
import { useUserCredentialManager } from '../../../utils/services';
import { AGENT_CREDENTIAL_MAPPINGS } from '../../../utils/user-credentials';

export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event);
  const agentId = getRouterParam(event, 'agentId');
  const mapping = AGENT_CREDENTIAL_MAPPINGS.find((m) => m.agentId === agentId);
  if (!mapping) {
    throw createError({ statusCode: 400, statusMessage: `Unknown agent id: ${agentId}` });
  }

  const mgr = useUserCredentialManager();
  await mgr.reset(user.id, mapping.fileName);
  return { ok: true };
});
