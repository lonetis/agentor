defineRouteMeta({
  openAPI: {
    tags: ['Setup'],
    summary: 'First-run setup status',
    description: 'Returns whether the system still needs an initial admin user, and which auth features are enabled.',
    operationId: 'getSetupStatus',
    responses: {
      200: {
        description: 'Setup status',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                needsSetup: { type: 'boolean', description: 'True if no users exist yet' },
                passkeysEnabled: { type: 'boolean', description: 'True when passkey authentication is configured (requires the dashboard to be served over Traefik with DASHBOARD_SUBDOMAIN set)' },
              },
              required: ['needsSetup', 'passkeysEnabled'],
            },
          },
        },
      },
    },
  },
});

import { hasAnyUsers, useAuth, isPasskeyEnabled } from '../../utils/auth';

export default defineEventHandler(() => {
  // Ensure auth is initialized (so the user table exists before we query it)
  useAuth();
  return {
    needsSetup: !hasAnyUsers(),
    passkeysEnabled: isPasskeyEnabled(),
  };
});
