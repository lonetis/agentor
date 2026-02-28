import { useDomainMappingStore, useConfig } from '../../utils/services';

export default defineEventHandler(() => {
  const config = useConfig();
  const mappings = useDomainMappingStore().list();

  return {
    enabled: config.baseDomains.length > 0,
    baseDomains: config.baseDomains,
    totalMappings: mappings.length,
    ...(config.dashboardSubdomain && config.dashboardBaseDomain
      ? { dashboardUrl: `https://${config.dashboardSubdomain}.${config.dashboardBaseDomain}` }
      : {}),
  };
});
