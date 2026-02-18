import { useUpdateChecker } from '../../utils/services';

export default defineEventHandler(async () => {
  return useUpdateChecker().check();
});
