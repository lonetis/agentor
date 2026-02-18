import { useUpdateChecker } from '../../utils/services';

export default defineEventHandler(() => {
  return useUpdateChecker().getStatus();
});
