import { useContainerManager } from '../../utils/services';

export default defineEventHandler(() => {
  return useContainerManager().listArchived();
});
