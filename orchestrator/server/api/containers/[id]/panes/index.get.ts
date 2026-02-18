import { useContainerManager } from '../../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();
  return containerManager.listTmuxWindows(id);
});
