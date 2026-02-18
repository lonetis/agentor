import { useContainerManager } from '../utils/services';

export default defineEventHandler(() => {
  const containerManager = useContainerManager();
  return {
    status: 'ok',
    containers: containerManager.list().length,
  };
});
