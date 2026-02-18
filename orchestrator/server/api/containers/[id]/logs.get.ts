import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const query = getQuery(event);
  const parsed = query.tail ? parseInt(query.tail as string, 10) : 200;
  const tail = isNaN(parsed) || parsed < 1 ? 200 : Math.min(parsed, 10000);
  const containerManager = useContainerManager();
  const logs = await containerManager.logs(id, tail);
  return { logs };
});
