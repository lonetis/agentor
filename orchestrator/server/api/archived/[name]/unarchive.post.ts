import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')!;
  const container = await useContainerManager().unarchive(name);
  return container;
});
