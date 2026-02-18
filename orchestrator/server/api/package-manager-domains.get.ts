import { getPackageManagerDomains } from '../utils/environments';

export default defineEventHandler(() => {
  return getPackageManagerDomains();
});
