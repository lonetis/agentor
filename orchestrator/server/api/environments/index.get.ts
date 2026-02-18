import { useEnvironmentStore } from '../../utils/services';

export default defineEventHandler(() => {
  return useEnvironmentStore().list();
});
