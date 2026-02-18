import { useContainerManager } from '../../utils/services';

export default defineEventHandler(() => {
  return { name: useContainerManager().generateName() };
});
