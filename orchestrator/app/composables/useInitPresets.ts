import type { InitPresetInfo } from '~/types';

export function useInitPresets() {
  const { data: initPresets } = useFetch<InitPresetInfo[]>('/api/init-presets', {
    default: () => [],
  });

  return { initPresets };
}
