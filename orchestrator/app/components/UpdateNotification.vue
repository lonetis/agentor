<script setup lang="ts">
import type { ImageUpdateInfo, UpdatableImage } from '~/types';

const {
  status,
  isChecking,
  isApplying,
  isPruning,
  isRestarting,
  applyErrors,
  applyingImages,
  lastPruneResult,
  updatesAvailable,
  isProductionMode,
  checkNow,
  applyUpdates,
  applyImage,
  pruneImages,
} = useUpdates();

function shortDigest(digest: string): string {
  if (!digest) return '';
  const hash = digest.startsWith('sha256:') ? digest.slice(7) : digest;
  return hash.slice(0, 12);
}

function imageName(fullName: string): string {
  const agentorMatch = fullName.match(/agentor-(\w+):/);
  if (agentorMatch) return agentorMatch[1]!;
  const parts = fullName.split(':')[0] ?? fullName;
  const segments = parts.split('/');
  return segments[segments.length - 1]!;
}

function imageKey(info: ImageUpdateInfo): UpdatableImage | null {
  if (status.value?.orchestrator === info) return 'orchestrator';
  if (status.value?.worker === info) return 'worker';
  if (status.value?.traefik === info) return 'traefik';
  return null;
}

const imageList = computed(() =>
  [status.value?.orchestrator, status.value?.worker, status.value?.traefik]
    .filter((i): i is ImageUpdateInfo => !!i)
);

const anyApplyingImage = computed(() => applyingImages.value.size > 0);

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
</script>

<template>
  <div>
    <!-- Restarting overlay -->
    <div
      v-if="isRestarting"
      class="rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 text-center"
    >
      <div class="flex items-center justify-center gap-2 text-blue-700 dark:text-blue-300 text-sm font-medium">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        Reconnecting...
      </div>
      <p class="text-xs text-blue-600 dark:text-blue-400 mt-1">Orchestrator is restarting with the new image.</p>
    </div>

    <template v-else>
      <!-- Image list (grid: name column auto-sizes, hash column left-aligned) -->
      <div class="grid gap-x-3 gap-y-1.5 text-xs items-center" style="grid-template-columns: auto 1fr">
        <template v-for="info in imageList" :key="info.name">
          <span class="font-medium text-gray-600 dark:text-gray-400">{{ imageName(info.name) }}</span>
          <div class="flex items-center gap-1.5">
            <template v-if="isProductionMode && info.updateAvailable">
              <div class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
              <span class="text-amber-600 dark:text-amber-400 font-mono text-[10px]">
                {{ shortDigest(info.localDigest) }} &rarr; {{ shortDigest(info.remoteDigest) }}
              </span>
              <button
                v-if="imageKey(info)"
                class="ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700 disabled:opacity-50"
                :disabled="isApplying || anyApplyingImage || isChecking"
                @click="applyImage(imageKey(info)!)"
              >
                <template v-if="applyingImages.has(imageKey(info)!)">...</template>
                <template v-else>Update</template>
              </button>
            </template>
            <template v-else-if="info.error">
              <span class="text-red-500 text-[10px]">error</span>
            </template>
            <template v-else-if="info.localDigest">
              <span class="text-gray-400 dark:text-gray-500 font-mono text-[10px]">{{ shortDigest(info.localDigest) }}</span>
              <span
                v-if="isProductionMode"
                class="text-green-600 dark:text-green-500 text-[10px]"
              >&#10003;</span>
            </template>
            <template v-else>
              <span class="text-gray-400 dark:text-gray-600 text-[10px] italic">not found</span>
            </template>
          </div>
        </template>
      </div>

      <!-- No images loaded yet -->
      <div v-if="imageList.length === 0 && !status" class="text-[10px] text-gray-400 dark:text-gray-600 italic">
        Loading...
      </div>

      <!-- Error messages -->
      <div v-if="applyErrors.length > 0" class="mt-2">
        <p
          v-for="(err, i) in applyErrors"
          :key="i"
          class="text-xs text-red-600 dark:text-red-400"
        >
          {{ err }}
        </p>
      </div>

      <!-- Production mode: update actions -->
      <div v-if="isProductionMode && updatesAvailable > 0" class="mt-2 flex gap-2">
        <UButton
          size="xs"
          color="warning"
          :loading="isApplying"
          :disabled="isChecking || anyApplyingImage"
          @click="applyUpdates"
        >
          Update All
        </UButton>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :loading="isChecking"
          :disabled="isApplying || anyApplyingImage"
          @click="checkNow"
        >
          Re-check
        </UButton>
      </div>

      <!-- Actions (separator + interactive rows) -->
      <div v-if="status" class="mt-2.5 pt-2.5 border-t border-gray-200 dark:border-gray-700/50 -mx-3 px-1.5 space-y-0.5">
        <!-- Check for updates (production only, when up to date) -->
        <button
          v-if="isProductionMode && updatesAvailable === 0"
          class="system-card-link disabled:opacity-50"
          :disabled="isChecking"
          @click="checkNow"
        >
          <UIcon name="i-lucide-refresh-cw" class="size-3.5 flex-shrink-0" :class="{ 'animate-spin': isChecking }" />
          {{ isChecking ? 'Checking...' : 'Check for updates' }}
        </button>

        <!-- Prune dangling images -->
        <button
          class="system-card-link disabled:opacity-50"
          :disabled="isPruning || isApplying || anyApplyingImage"
          @click="pruneImages"
        >
          <UIcon name="i-lucide-trash-2" class="size-3.5 flex-shrink-0" />
          {{ isPruning ? 'Pruning...' : 'Prune dangling images' }}
          <span
            v-if="lastPruneResult"
            class="ml-auto text-[10px] text-gray-400 dark:text-gray-500 font-normal"
          >
            {{ lastPruneResult.imagesDeleted }} removed
          </span>
        </button>
      </div>
    </template>
  </div>
</template>
