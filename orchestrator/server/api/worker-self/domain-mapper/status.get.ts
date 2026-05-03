defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Domain mapper status (worker-self view)',
    description: 'Returns whether domain mapping is enabled and which base domains are configured. Caller is identified by source IP.',
    operationId: 'workerSelfDomainMapperStatus',
    responses: {
      200: { description: 'Domain mapper status' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
    },
  },
});

import { useDomainMappingStore, useConfig } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  await requireWorkerSelf(event);

  const config = useConfig();
  const mappings = useDomainMappingStore().list();

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
