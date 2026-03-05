import type { InitScriptInfo } from '~/types';

export function useInitScriptSync(
  initScripts: Ref<InitScriptInfo[]> | ComputedRef<InitScriptInfo[]>,
  initScript: Ref<string>,
) {
  const selectedPreset = ref('none');
  let suppressScriptSync = false;

  const presetOptions = computed(() => [
    { label: 'None', value: 'none' },
    ...initScripts.value.map((p) => ({ label: p.name, value: p.id })),
    { label: 'Custom', value: 'custom' },
  ]);

  // Dropdown -> textarea
  watch(selectedPreset, (val) => {
    suppressScriptSync = true;
    if (val === 'none') {
      initScript.value = '';
    } else if (val !== 'custom') {
      const script = initScripts.value.find((p) => p.id === val);
      if (script) initScript.value = script.content;
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
    const match = initScripts.value.find((p) => p.content === trimmed);
    selectedPreset.value = match ? match.id : 'custom';
  });

  return { selectedPreset, presetOptions };
}
