import { useUsageChecker } from '../utils/services';

export default defineEventHandler(() => useUsageChecker().getStatus());
