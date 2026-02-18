import { useContainerManager } from '../../../../utils/services';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();
  return containerManager.getServiceStatus(id);
});
