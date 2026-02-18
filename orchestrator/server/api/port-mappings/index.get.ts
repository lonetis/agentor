import { usePortMappingStore } from '../../utils/services';

export default defineEventHandler(() => {
  return usePortMappingStore().list();
});
