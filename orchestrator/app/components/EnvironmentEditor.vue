<script setup lang="ts">
import type { InitPresetInfo, EnvironmentInfo, NetworkMode, OrchestratorEnvVar } from '~/types';

const props = defineProps<{
  initPresets: InitPresetInfo[];
  environment?: EnvironmentInfo;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  save: [data: Partial<EnvironmentInfo>];
  cancel: [];
}>();

const form = reactive({
  name: '',
  cpuLimit: 0,
  memoryLimit: '',
  networkMode: 'full' as NetworkMode,
  allowedDomains: '',
  includePackageManagerDomains: false,
  dockerEnabled: true,
  envVars: '',
  setupScript: '',
  initScript: '',
});

const { selectedPreset, presetOptions } = useInitPresetSync(
  computed(() => props.initPresets),
  toRef(form, 'initScript'),
);

const systemEnvVars = ref<OrchestratorEnvVar[]>([]);

const networkModeOptions = [
  { label: 'Full', value: 'full', description: 'Unrestricted network access' },
  { label: 'Package managers', value: 'package-managers', description: 'Only package registries' },
  { label: 'Custom', value: 'custom', description: 'User-defined domains' },
  { label: 'Block', value: 'block', description: 'Agent API only' },
  { label: 'Block all', value: 'block-all', description: 'No outbound network' },
];

const { data: packageManagerDomains } = useFetch<string[]>('/api/package-manager-domains', { default: () => [] });
const showPmDomains = ref(false);
const showAgentDomains = ref(false);

const allApiDomains = computed(() => {
  const domains = new Set<string>();
  for (const p of props.initPresets) {
    for (const d of p.apiDomains) domains.add(d);
  }
  return [...domains].sort();
});

async function fetchSystemEnvVars() {
  try {
    systemEnvVars.value = await $fetch<OrchestratorEnvVar[]>('/api/orchestrator-env-vars');
  } catch {
    systemEnvVars.value = [];
  }
}

// Initialize form from props
function initForm() {
  if (props.environment) {
    form.name = props.environment.name;
    form.cpuLimit = props.environment.cpuLimit;
    form.memoryLimit = props.environment.memoryLimit;
    form.networkMode = props.environment.networkMode;
    form.allowedDomains = props.environment.allowedDomains.join('\n');
    form.includePackageManagerDomains = props.environment.includePackageManagerDomains;
    form.dockerEnabled = props.environment.dockerEnabled ?? true;
    form.envVars = props.environment.envVars;
    form.setupScript = props.environment.setupScript;
    form.initScript = props.environment.initScript;
  }
  fetchSystemEnvVars();
}

watch(() => props.environment, () => initForm(), { immediate: true });

function handleSave() {
  if (!form.name.trim()) return;

  const domains = form.allowedDomains
    .split('\n')
    .map((d) => d.trim())
    .filter(Boolean);

  emit('save', {
    name: form.name.trim(),
    cpuLimit: form.cpuLimit,
    memoryLimit: form.memoryLimit,
    networkMode: form.networkMode,
    allowedDomains: domains,
    includePackageManagerDomains: form.includePackageManagerDomains,
    dockerEnabled: form.dockerEnabled,
    envVars: form.envVars,
    setupScript: form.setupScript,
    initScript: form.initScript,
  });
}
</script>

<template>
  <div class="space-y-5">
    <!-- Name -->
    <UFormField label="Name">
      <UInput v-model="form.name" placeholder="My environment" class="w-full" :disabled="readOnly" />
    </UFormField>

    <!-- Resource Limits -->
    <fieldset>
      <legend class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Resource Limits</legend>
      <div class="grid grid-cols-2 gap-4">
        <UFormField label="CPU" hint="0 = unrestricted">
          <UInput v-model.number="form.cpuLimit" type="number" :min="0" :step="0.5" placeholder="0" class="w-full" :disabled="readOnly" />
        </UFormField>
        <UFormField label="Memory" hint="e.g. 4g, 512m, empty = unrestricted">
          <UInput v-model="form.memoryLimit" placeholder="" class="w-full" :disabled="readOnly" />
        </UFormField>
      </div>
    </fieldset>

    <!-- Docker-in-Docker -->
    <fieldset>
      <legend class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Docker</legend>
      <label class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400" :class="readOnly ? 'cursor-default' : 'cursor-pointer'">
        <UCheckbox v-model="form.dockerEnabled" :disabled="readOnly" />
        Enable Docker-in-Docker
      </label>
      <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
        Runs a Docker daemon inside the worker container. Requires privileged mode.
      </p>
    </fieldset>

    <!-- Network Access -->
    <fieldset>
      <legend class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Network Access</legend>
      <div class="flex flex-wrap gap-3 mb-3">
        <label
          v-for="opt in networkModeOptions"
          :key="opt.value"
          class="flex items-center gap-2 px-3 py-1.5 rounded-md border transition-colors"
          :class="[
            form.networkMode === opt.value
              ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
              : 'border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-600',
            readOnly ? 'cursor-default' : 'cursor-pointer',
          ]"
        >
          <input
            v-model="form.networkMode"
            type="radio"
            :value="opt.value"
            :disabled="readOnly"
            class="sr-only"
          />
          <span class="text-sm font-medium">{{ opt.label }}</span>
        </label>
      </div>

      <div v-if="form.networkMode === 'custom'" class="space-y-2">
        <UFormField label="Allowed domains" hint="One per line, supports * wildcards">
          <UTextarea
            v-model="form.allowedDomains"
            :rows="4"
            placeholder="*.example.com&#10;api.myservice.com"
            class="w-full font-mono text-xs"
            :disabled="readOnly"
          />
        </UFormField>
        <label class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400" :class="readOnly ? 'cursor-default' : 'cursor-pointer'">
          <UCheckbox v-model="form.includePackageManagerDomains" :disabled="readOnly" />
          Also include package manager domains
        </label>
      </div>

      <!-- Package manager domains info -->
      <div
        v-if="form.networkMode === 'package-managers' || (form.networkMode === 'custom' && form.includePackageManagerDomains)"
        class="mt-2"
      >
        <button
          type="button"
          class="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
          @click="showPmDomains = !showPmDomains"
        >
          <UIcon
            :name="showPmDomains ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
            class="w-3 h-3"
          />
          {{ packageManagerDomains?.length || 0 }} package manager domains
          <span class="text-gray-400 dark:text-gray-600">(configurable via PACKAGE_MANAGER_DOMAINS env var)</span>
        </button>
        <div v-if="showPmDomains" class="mt-1.5 max-h-48 overflow-y-auto rounded border border-gray-300 dark:border-gray-700 bg-gray-100/60 dark:bg-gray-800/50 p-2">
          <div
            v-for="domain in packageManagerDomains"
            :key="domain"
            class="text-xs font-mono text-gray-500 dark:text-gray-400 leading-5"
          >
            {{ domain }}
          </div>
        </div>
      </div>

      <!-- Agent API domains (always allowed in restricted modes) -->
      <div
        v-if="form.networkMode !== 'full' && form.networkMode !== 'block-all' && allApiDomains.length > 0"
        class="mt-2"
      >
        <button
          type="button"
          class="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
          @click="showAgentDomains = !showAgentDomains"
        >
          <UIcon
            :name="showAgentDomains ? 'i-heroicons-chevron-down' : 'i-heroicons-chevron-right'"
            class="w-3 h-3"
          />
          {{ allApiDomains.length }} agent API domains
          <span class="text-gray-400 dark:text-gray-600">(always allowed so the agent can reach its model)</span>
        </button>
        <div v-if="showAgentDomains" class="mt-1.5 max-h-48 overflow-y-auto rounded border border-gray-300 dark:border-gray-700 bg-gray-100/60 dark:bg-gray-800/50 p-2">
          <div
            v-for="domain in allApiDomains"
            :key="domain"
            class="text-xs font-mono text-gray-500 dark:text-gray-400 leading-5"
          >
            {{ domain }}
          </div>
        </div>
      </div>
    </fieldset>

    <!-- Environment Variables -->
    <fieldset>
      <legend class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Environment Variables</legend>

      <!-- System env vars (read-only) -->
      <div v-if="systemEnvVars.length > 0" class="mb-3">
        <div class="text-xs text-gray-400 dark:text-gray-500 mb-1">System (read-only, set by orchestrator)</div>
        <div class="space-y-1">
          <div
            v-for="v in systemEnvVars"
            :key="v.name"
            class="flex items-center gap-2 text-xs font-mono px-2 py-1 bg-gray-100/60 dark:bg-gray-800/50 rounded"
          >
            <UIcon name="i-heroicons-lock-closed" class="text-gray-400 dark:text-gray-500 w-3 h-3 shrink-0" />
            <span class="text-gray-500 dark:text-gray-400">{{ v.name }}</span>
            <span class="text-gray-400 dark:text-gray-600">=</span>
            <span :class="v.configured ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-600'">
              {{ v.configured ? 'configured' : 'not set' }}
            </span>
          </div>
        </div>
      </div>

      <UFormField v-if="!readOnly" label="Custom" hint=".env format (KEY=VALUE)">
        <UTextarea
          v-model="form.envVars"
          :rows="3"
          placeholder="MY_VAR=value&#10;ANOTHER=123"
          class="w-full font-mono text-xs"
        />
      </UFormField>
    </fieldset>

    <!-- Setup Script -->
    <UFormField label="Setup Script" hint="Runs before agent starts (under firewall policy)">
      <UTextarea
        v-model="form.setupScript"
        :rows="4"
        placeholder="#!/bin/bash&#10;# Install dependencies before the agent starts"
        class="w-full font-mono text-xs"
        :disabled="readOnly"
      />
    </UFormField>

    <!-- Init Script -->
    <UFormField label="Init Script" hint="Script to run in tmux on startup">
      <div class="space-y-2">
        <USelect v-model="selectedPreset" :items="presetOptions" class="w-full" :disabled="readOnly" />
        <UTextarea
          v-model="form.initScript"
          :rows="4"
          placeholder="#!/bin/bash&#10;# Script to run in tmux on startup"
          class="w-full font-mono text-xs"
          :disabled="readOnly"
        />
      </div>
    </UFormField>

    <!-- Actions -->
    <div class="flex gap-3 pt-2">
      <UButton v-if="!readOnly" @click="handleSave" :disabled="!form.name.trim()">
        {{ environment ? 'Update' : 'Create' }}
      </UButton>
      <UButton color="neutral" variant="outline" @click="emit('cancel')">
        {{ readOnly ? 'Close' : 'Cancel' }}
      </UButton>
    </div>
  </div>
</template>
