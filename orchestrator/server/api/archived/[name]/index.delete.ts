import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')!;
  await useContainerManager().deleteArchived(name);
  return { ok: true };
});
