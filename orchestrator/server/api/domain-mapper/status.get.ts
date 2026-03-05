defineRouteMeta({
  openAPI: {
    tags: ['Domain Mappings'],
    summary: 'Get domain mapper status',
    description: 'Returns domain mapper status including enabled state and configured base domains.',
    operationId: 'getDomainMapperStatus',
    responses: {
      200: {
        description: 'Domain mapper status',
        content: { 'application/json': { schema: { type: 'object', properties: { enabled: { type: 'boolean' }, baseDomains: { type: 'array', items: { type: 'string' } } } } } },
      },
    },
  },
});

import { useDomainMappingStore, useConfig } from '../../utils/services';

export default defineEventHandler(() => {
  const config = useConfig();
  const mappings = useDomainMappingStore().list();

  const dashboardDomainConfig = config.baseDomainConfigs.find((c) => c.domain === config.dashboardBaseDomain);
  const dashboardHasTls = dashboardDomainConfig ? dashboardDomainConfig.challengeType !== 'none' : false;
  const dashboardScheme = dashboardHasTls ? 'https' : 'http';

  return {
    enabled: config.baseDomains.length > 0,
    baseDomains: config.baseDomains,
    baseDomainConfigs: config.baseDomainConfigs.map((c) => ({
      domain: c.domain,
      challengeType: c.challengeType,
      ...(c.dnsProvider ? { dnsProvider: c.dnsProvider } : {}),
    })),
    totalMappings: mappings.length,
    ...(config.dashboardSubdomain && config.dashboardBaseDomain
      ? { dashboardUrl: `${dashboardScheme}://${config.dashboardSubdomain}.${config.dashboardBaseDomain}` }
      : {}),
  };
});
