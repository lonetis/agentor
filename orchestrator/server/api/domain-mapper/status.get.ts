defineRouteMeta({
  openAPI: {
    tags: ['Domain Mappings'],
    summary: 'Get domain mapper status',
    description: 'Returns domain mapper status including enabled state and configured base domains.',
    operationId: 'getDomainMapperStatus',
    responses: {
      200: {
        description: 'Domain mapper status',
        content: { 'application/json': { schema: { type: 'object', properties: { enabled: { type: 'boolean' }, baseDomains: { type: 'array', items: { type: 'string' } }, baseDomainConfigs: { type: 'array', items: { type: 'object', properties: { domain: { type: 'string' }, challengeType: { type: 'string' }, dnsProvider: { type: 'string' } } } }, totalMappings: { type: 'integer' }, hasSelfSignedCa: { type: 'boolean' }, dashboardUrl: { type: 'string' } } } } },
      },
    },
  },
});

import { useDomainMappingStore, useConfig } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const config = useConfig();
  const all = useDomainMappingStore().list();
  // Scope the mapping count to the caller (admins keep the global total); the
  // config-level fields below are fine to expose to any authenticated user.
  const mappings = user.role === 'admin' ? all : all.filter((m) => m.userId === user.id);

  const dashboardDomainConfig = config.baseDomainConfigs.find((c) => c.domain === config.dashboardBaseDomain);
  const dashboardHasTls = dashboardDomainConfig ? dashboardDomainConfig.challengeType !== 'none' : false;
  const dashboardScheme = dashboardHasTls ? 'https' : 'http';

  const hasSelfSigned = config.baseDomainConfigs.some((c) => c.challengeType === 'selfsigned');

  return {
    enabled: config.baseDomains.length > 0,
    baseDomains: config.baseDomains,
    baseDomainConfigs: config.baseDomainConfigs.map((c) => ({
      domain: c.domain,
      challengeType: c.challengeType,
      ...(c.dnsProvider ? { dnsProvider: c.dnsProvider } : {}),
    })),
    totalMappings: mappings.length,
    ...(hasSelfSigned ? { hasSelfSignedCa: true } : {}),
    ...(config.dashboardSubdomain && config.dashboardBaseDomain
      ? { dashboardUrl: `${dashboardScheme}://${config.dashboardSubdomain}.${config.dashboardBaseDomain}` }
      : {}),
  };
});
