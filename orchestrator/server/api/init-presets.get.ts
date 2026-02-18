import { listInitPresets } from '../utils/init-presets';

export default defineEventHandler(() => {
  return listInitPresets().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    script: p.script,
    apiDomains: p.apiDomains,
  }));
});
