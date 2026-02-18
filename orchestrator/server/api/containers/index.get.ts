import { useContainerManager } from '../../utils/services';

export default defineEventHandler(async () => {
  const containerManager = useContainerManager();
  await containerManager.sync();
  return containerManager.list();
});
