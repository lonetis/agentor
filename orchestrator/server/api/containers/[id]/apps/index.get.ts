import { useContainerManager } from '../../../../utils/services';
import { listAppTypes } from '../../../../utils/apps';
import type { AppInstanceInfo } from '../../../../../shared/types';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();

  const allInstances: AppInstanceInfo[] = [];

  for (const appType of listAppTypes()) {
    try {
      const instances = await containerManager.listAppInstances(id, appType.id);
      allInstances.push(...instances);
    } catch {
      // Container might be stopped or app script missing
    }
  }

  return allInstances;
});
