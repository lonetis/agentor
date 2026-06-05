defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List worker system environment variables',
    description:
      'Returns the system environment variables the orchestrator (or the worker entrypoint) injects into every worker container — the complete set of orchestrator-provided env a worker actually receives. These are infrastructural, non-secret, and always present. Orchestrator-wide settings (BETTER_AUTH_*, DASHBOARD_*, ACME_*, BASE_DOMAINS, LOG_*) are NOT passed to workers and are intentionally absent here. Per-user values (agent API keys, the GitHub token, custom keys) are managed via /api/account/env-vars and are not listed here either.',
    operationId: 'listWorkerEnvVars',
    responses: {
      200: {
        description: 'Array of worker system environment variable descriptors',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                },
                required: ['name', 'description'],
              },
            },
          },
        },
      },
    },
  },
});

import { WORKER_SYSTEM_ENV_VARS } from '../utils/user-env-store';

export default defineEventHandler(() => {
  // Sourced from the single source of truth that also drives the reserved-key
  // guard, so the editor's read-only list can never drift from what a worker
  // actually receives.
  return WORKER_SYSTEM_ENV_VARS;
});
