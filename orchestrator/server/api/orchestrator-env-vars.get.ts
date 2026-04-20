defineRouteMeta({
  openAPI: {
    tags: ['Config'],
    summary: 'List orchestrator environment variables',
    description: 'Returns orchestrator-wide environment variables that influence platform behaviour (logging, Traefik, ACME DNS providers, dashboard auth, etc.). Does NOT include agent API keys or git provider tokens — those are per-user and managed via `/api/account/env-vars`.',
    operationId: 'listOrchestratorEnvVars',
    responses: {
      200: {
        description: 'Array of environment variable objects',
        content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, configured: { type: 'boolean' } } } } } },
      },
    },
  },
});

import { useConfig } from '../utils/services';

export default defineEventHandler(() => {
  const config = useConfig();
  const vars: { name: string; configured: boolean }[] = [];

  const push = (name: string, value: unknown) => {
    vars.push({ name, configured: !!value && String(value).length > 0 });
  };

  // Dashboard auth (basic auth in front of Traefik)
  push('DASHBOARD_AUTH_USER', config.dashboardAuthUser);
  push('DASHBOARD_AUTH_PASSWORD', config.dashboardAuthPassword);

  // Domain routing
  push('BASE_DOMAINS', config.baseDomains.join(','));
  push('DASHBOARD_SUBDOMAIN', config.dashboardSubdomain);
  push('DASHBOARD_BASE_DOMAIN', config.dashboardBaseDomain);
  push('ACME_EMAIL', config.acmeEmail);

  // Better-auth
  push('BETTER_AUTH_SECRET', config.betterAuthSecret);

  return vars;
});
