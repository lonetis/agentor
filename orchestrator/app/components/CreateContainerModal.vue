<script setup lang="ts">
import type { GitProviderInfo, MountConfig, RepoConfig, CreateContainerRequest, GitHubBranchInfo, GitHubRepoInfo } from '~/types';

const props = defineProps<{
  gitProviders: GitProviderInfo[];
}>();

const emit = defineEmits<{
  create: [request: CreateContainerRequest, files: File[]];
  manageEnvironments: [];
  manageInitScripts: [];
}>();

const open = defineModel<boolean>('open', { default: false });

const { environments } = useEnvironments();

const {
  repos: githubRepos,
  reposLoading: githubReposLoading,
  username: githubUser,
  orgs: githubOrgs,
  fetchRepos,
  addRepoToList,
} = useGitHubRepos();

// Per-repo-row branch state keyed by stable row ID
const branchData = reactive(new Map<number, { branches: GitHubBranchInfo[]; loading: boolean; defaultBranch: string }>());
const creatingRepo = reactive(new Map<number, boolean>());
let rowCounter = 0;
const repoRowIds = reactive(new Map<number, number>());

const generatedName = ref('');

watch(open, async (isOpen) => {
  if (isOpen) {
    fetchRepos();
    const { name } = await $fetch<{ name: string }>('/api/containers/generate-name');
    generatedName.value = name;
  }
});

const form = reactive({
  displayName: '',
  environmentId: 'default',
  repos: [] as RepoConfig[],
  mounts: [] as MountConfig[],
  files: [] as File[],
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
  const idx = form.repos.length;
  form.repos.push({ provider: defaultProvider.value, url: '', branch: '' });
  repoRowIds.set(idx, ++rowCounter);
}

function removeRepo(idx: number) {
  const rowId = repoRowIds.get(idx);
  if (rowId !== undefined) {
    branchData.delete(rowId);
    creatingRepo.delete(rowId);
  }
  form.repos.splice(idx, 1);
  // Re-index row IDs after splice
  const newMap = new Map<number, number>();
  for (const [k, v] of repoRowIds) {
    if (k < idx) newMap.set(k, v);
    else if (k > idx) newMap.set(k - 1, v);
  }
  repoRowIds.clear();
  for (const [k, v] of newMap) repoRowIds.set(k, v);
}

async function onRepoSelected(idx: number, fullName: string) {
  const rowId = repoRowIds.get(idx);
  if (rowId === undefined) return;

  branchData.set(rowId, { branches: [], loading: true, defaultBranch: '' });

  try {
    const [owner, repo] = fullName.split('/');
    const data = await $fetch<{ branches: GitHubBranchInfo[]; defaultBranch: string }>(
      `/api/github/repos/${owner}/${repo}/branches`,
    );
    branchData.set(rowId, { branches: data.branches, loading: false, defaultBranch: data.defaultBranch });
  } catch {
    branchData.set(rowId, { branches: [], loading: false, defaultBranch: '' });
  }
}

async function onCreateRepo(idx: number, payload: { owner: string; name: string; isPrivate: boolean }) {
  const rowId = repoRowIds.get(idx);
  if (rowId === undefined) return;

  creatingRepo.set(rowId, true);
  try {
    const data = await $fetch<{ repo: GitHubRepoInfo }>('/api/github/repos', {
      method: 'POST',
      body: { owner: payload.owner, name: payload.name, private: payload.isPrivate },
    });

    addRepoToList(data.repo);
    form.repos[idx] = { ...form.repos[idx]!, url: data.repo.fullName };
    await onRepoSelected(idx, data.repo.fullName);
  } catch {
    // API error — leave the URL as-is so the user can retry
  } finally {
    creatingRepo.set(rowId, false);
  }
}

function getBranchData(idx: number) {
  const rowId = repoRowIds.get(idx);
  return rowId !== undefined ? branchData.get(rowId) : undefined;
}

function getCreatingRepo(idx: number) {
  const rowId = repoRowIds.get(idx);
  return rowId !== undefined ? creatingRepo.get(rowId) ?? false : false;
}

function addMount() {
  form.mounts.push({ source: '', target: '', readOnly: false });
}

function removeMount(idx: number) {
  form.mounts.splice(idx, 1);
}

function sanitizeContainerName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function submit() {
  const customName = form.displayName.trim();
  const request: CreateContainerRequest = {
    name: customName ? `agentor-worker-${sanitizeContainerName(customName)}` : generatedName.value,
  };
  if (form.environmentId) request.environmentId = form.environmentId;
  if (customName) request.displayName = customName;
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
  emit('create', request, [...form.files]);
  reset();
  open.value = false;
}

function reset() {
  form.displayName = '';
  form.environmentId = 'default';
  form.repos = [];
  form.mounts = [];
  form.files = [];
  form.initScript = '';
  generatedName.value = '';
  branchData.clear();
  creatingRepo.clear();
  repoRowIds.clear();
  rowCounter = 0;
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-3xl' }">
    <template #content>
      <div class="p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">New Worker</h2>

        <UFormField label="Name">
          <UInput
            v-model="form.displayName"
            :placeholder="shortName(generatedName)"
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
              :key="repoRowIds.get(idx) ?? idx"
              :model-value="repo"
              @update:model-value="form.repos[idx] = $event"
              :providers="gitProviders"
              :github-repos="githubRepos"
              :github-repos-loading="githubReposLoading"
              :github-branches="getBranchData(idx)?.branches"
              :github-branches-loading="getBranchData(idx)?.loading"
              :github-default-branch="getBranchData(idx)?.defaultBranch"
              :github-user="githubUser"
              :github-orgs="githubOrgs"
              :creating-repo="getCreatingRepo(idx)"
              @remove="removeRepo(idx)"
              @repo-selected="onRepoSelected(idx, $event)"
              @create-repo="onCreateRepo(idx, $event)"
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

        <UFormField label="Upload Files" hint="Uploaded to /workspace after container starts">
          <FileDropZone v-model="form.files" />
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
