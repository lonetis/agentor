import type { InitPresetInfo } from '~/types';

export function useInitPresetSync(
  initPresets: Ref<InitPresetInfo[]> | ComputedRef<InitPresetInfo[]>,
  initScript: Ref<string>,
) {
  const selectedPreset = ref('none');
  let suppressScriptSync = false;

  const presetOptions = computed(() => [
    { label: 'None', value: 'none' },
    ...initPresets.value.map((p) => ({ label: p.displayName, value: p.id })),
    { label: 'Custom', value: 'custom' },
  ]);

  // Dropdown -> textarea
  watch(selectedPreset, (val) => {
    suppressScriptSync = true;
    if (val === 'none') {
      initScript.value = '';
    } else if (val !== 'custom') {
      const preset = initPresets.value.find((p) => p.id === val);
      if (preset) initScript.value = preset.script;
    }
    nextTick(() => { suppressScriptSync = false; });
  });

  // Textarea -> dropdown
  watch(initScript, (val) => {
    if (suppressScriptSync) return;
    const trimmed = val.trim();
    if (!trimmed) {
      selectedPreset.value = 'none';
      return;
    }
    const match = initPresets.value.find((p) => p.script === trimmed);
    selectedPreset.value = match ? match.id : 'custom';
  });

  return { selectedPreset, presetOptions };
}
