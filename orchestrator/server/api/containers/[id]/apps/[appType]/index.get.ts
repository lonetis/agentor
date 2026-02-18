import { useContainerManager } from '../../../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const appType = getRouterParam(event, 'appType')!;
  const containerManager = useContainerManager();
  try {
    return await containerManager.listAppInstances(id, appType);
  } catch {
    return [];
  }
});
