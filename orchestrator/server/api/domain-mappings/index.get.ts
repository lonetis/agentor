import { useDomainMappingStore } from '../../utils/services';

export default defineEventHandler(() => {
  return useDomainMappingStore().list();
});
