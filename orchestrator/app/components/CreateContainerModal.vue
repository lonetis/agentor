<script setup lang="ts">
import type { GitProviderInfo, MountConfig, RepoConfig, CreateContainerRequest } from '~/types';

const props = defineProps<{
  gitProviders: GitProviderInfo[];
}>();

const emit = defineEmits<{
  create: [request: CreateContainerRequest];
  manageEnvironments: [];
  manageInitScripts: [];
  'after:leave': [];
}>();

const open = defineModel<boolean>('open', { default: false });

const { environments, defaultEnvironmentId } = useEnvironments();

// Stable per-row keys: each RepoInput keeps its own branch / create state, so a
// row must stay bound to the same component when an earlier row is removed.
const repoKeys = ref<number[]>([]);
let nextRepoKey = 0;

const generatedName = ref('');

// Pre-select the built-in default environment once the list resolves — its id
// is a derived UUID, not known until the environments load.
watch(defaultEnvironmentId, (id) => {
  if (id && !form.environmentId) form.environmentId = id;
}, { immediate: true });

watch(open, async (isOpen) => {
  if (isOpen) {
    // Repo rows refetch their provider's list on first use after opening.
    useGitRepos().invalidate();
    const { displayName } = await $fetch<{ displayName: string }>('/api/containers/generate-name');
    generatedName.value = displayName;
  }
});

const form = reactive({
  displayName: '',
  environmentId: '',
  repos: [] as RepoConfig[],
  mounts: [] as MountConfig[],
  initScript: '',
});

const { initScripts } = useInitScripts();

const { selectedPreset, presetOptions } = useInitScriptSync(
  initScripts,
  toRef(form, 'initScript'),
);

const environmentOptions = computed(() =>
  environments.value.map((e) => ({ label: e.name, value: e.id })),
);

const defaultProvider = computed(() => props.gitProviders[0]?.id || 'github');

function addRepo() {
  form.repos.push({ provider: defaultProvider.value, url: '', branch: '' });
  repoKeys.value.push(nextRepoKey++);
}

function removeRepo(idx: number) {
  form.repos.splice(idx, 1);
  repoKeys.value.splice(idx, 1);
}

function addMount() {
  form.mounts.push({ source: '', target: '', readOnly: false });
}

function removeMount(idx: number) {
  form.mounts.splice(idx, 1);
}

function submit() {
  // The internal worker identity is a UUID v4 minted server-side; the form only
  // collects the editable, free-form display name. Send the suggested name when
  // the user leaves the field blank so the worker keeps the friendly label they
  // saw in the placeholder.
  const customName = form.displayName.trim();
  const request: CreateContainerRequest = {
    displayName: customName || generatedName.value,
  };
  if (form.environmentId) request.environmentId = form.environmentId;
  const validRepos = form.repos.filter((r) => r.url);
  if (validRepos.length > 0) {
    request.repos = validRepos.map((r) => ({
      provider: r.provider,
      url: r.url,
      ...(r.branch ? { branch: r.branch } : {}),
    }));
  }
  if (form.mounts.length > 0) {
    request.mounts = form.mounts.filter((m) => m.source && m.target);
  }
  if (form.initScript.trim()) {
    request.initScript = form.initScript;
  }
  emit('create', request);
  reset();
  open.value = false;
}

function reset() {
  form.displayName = '';
  form.environmentId = defaultEnvironmentId.value;
  form.repos = [];
  form.mounts = [];
  form.initScript = '';
  generatedName.value = '';
  repoKeys.value = [];
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-3xl' }" @after:leave="emit('after:leave')">
    <template #content>
      <div class="p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">New Worker</h2>

        <UFormField label="Display name">
          <UInput
            v-model="form.displayName"
            :placeholder="generatedName"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Environment">
          <div class="flex gap-2">
            <USelect v-model="form.environmentId" :items="environmentOptions" class="flex-1" />
            <UButton
              size="sm"
              color="neutral"
              variant="outline"
              @click="emit('manageEnvironments')"
            >
              Manage
            </UButton>
          </div>
        </UFormField>

        <UFormField label="Repositories">
          <div class="space-y-2">
            <RepoInput
              v-for="(repo, idx) in form.repos"
              :key="repoKeys[idx]"
              :model-value="repo"
              :providers="gitProviders"
              @update:model-value="form.repos[idx] = $event"
              @remove="removeRepo(idx)"
            />
          </div>
          <UButton
            size="xs"
            variant="link"
            class="mt-2"
            @click="addRepo"
          >
            + Add repository
          </UButton>
        </UFormField>

        <UFormField label="Volume Mounts">
          <div class="space-y-2">
            <MountInput
              v-for="(mount, idx) in form.mounts"
              :key="idx"
              :model-value="mount"
              @update:model-value="form.mounts[idx] = $event"
              @remove="removeMount(idx)"
            />
          </div>
          <UButton
            size="xs"
            variant="link"
            class="mt-2"
            @click="addMount"
          >
            + Add mount
          </UButton>
        </UFormField>

        <UFormField label="Init Script" hint="Script to run in tmux on startup">
          <div class="space-y-2">
            <div class="flex gap-2">
              <USelect v-model="selectedPreset" :items="presetOptions" class="flex-1" />
              <UButton
                size="sm"
                color="neutral"
                variant="outline"
                @click="emit('manageInitScripts')"
              >
                Manage
              </UButton>
            </div>
            <UTextarea
              v-model="form.initScript"
              :rows="3"
              placeholder="#!/bin/bash&#10;# Script to run in tmux on startup"
              class="w-full font-mono text-xs"
            />
          </div>
        </UFormField>

        <div class="flex gap-3 pt-2">
          <UButton class="flex-1" @click="submit">
            Create
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            @click="open = false; reset()"
          >
            Cancel
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
