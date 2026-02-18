import { useDomainMappingStore, useConfig } from '../../utils/services';

export default defineEventHandler(() => {
  const config = useConfig();
  const mappings = useDomainMappingStore().list();

  return {
    enabled: !!config.baseDomain,
    baseDomain: config.baseDomain,
    totalMappings: mappings.length,
    ...(config.dashboardSubdomain && config.baseDomain
      ? { dashboardUrl: `https://${config.dashboardSubdomain}.${config.baseDomain}` }
      : {}),
  };
});
