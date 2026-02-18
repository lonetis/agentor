import { usePortMappingStore } from '../../utils/services';

export default defineEventHandler(() => {
  const mappings = usePortMappingStore().list();
  let localhostCount = 0;
  let externalCount = 0;

  for (const m of mappings) {
    if (m.type === 'localhost') localhostCount++;
    else externalCount++;
  }

  return {
    totalMappings: mappings.length,
    localhostCount,
    externalCount,
  };
});
